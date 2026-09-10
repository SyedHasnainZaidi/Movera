"""Movement state machine and repetition counting tests.

Every guard described in app/state/movement.py is verified here with a
deliberately hostile input sequence, because rep counting is the single number
a patient will judge the whole system by.
"""

from __future__ import annotations

import pytest

from app.state.movement import (
    Direction,
    MovementConfig,
    MovementMachine,
    MovementState,
)

# Squat-like: rest is an extended (large) knee angle, peak is flexed (small).
SQUAT = MovementConfig(
    primary_angle="knee",
    direction=Direction.DECREASING,
    rest_angle=160.0,
    peak_angle=100.0,
    hysteresis_deg=8.0,
    min_state_frames=2,
    cooldown_ms=300,
    min_rep_duration_ms=500,
    max_rep_duration_ms=20_000,
)

# Shoulder-raise-like: rest is a small angle (arm at side), peak is large.
RAISE = MovementConfig(
    primary_angle="shoulder",
    direction=Direction.INCREASING,
    rest_angle=30.0,
    peak_angle=85.0,
    hysteresis_deg=6.0,
    min_state_frames=2,
    cooldown_ms=300,
    min_rep_duration_ms=500,
    max_rep_duration_ms=20_000,
)


def feed(
    machine: MovementMachine,
    angles: list[float],
    *,
    start: float = 0.0,
    step: float = 0.1,
    tracking_valid: bool = True,
) -> list[int]:
    """Push a sequence of angles; return the rep numbers that completed."""
    events: list[int] = []
    t = start
    for angle in angles:
        event = machine.update(angle, tracking_valid=tracking_valid, now=t)
        if event:
            events.append(event.rep_number)
        t += step
    return events


def hold(value: float, frames: int = 3) -> list[float]:
    return [value] * frames


def ramp(a: float, b: float, steps: int = 5) -> list[float]:
    return [a + (b - a) * i / steps for i in range(1, steps + 1)]


def one_squat() -> list[float]:
    """A clean full repetition: stand -> descend -> bottom -> ascend -> stand."""
    return (
        hold(170)
        + ramp(170, 95)
        + hold(92)
        + ramp(95, 170)
        + hold(172)
    )


class TestFullRepetition:
    def test_counts_one_clean_rep(self) -> None:
        m = MovementMachine(config=SQUAT)
        assert feed(m, one_squat()) == [1]
        assert m.rep_count == 1
        assert m.state is MovementState.UP

    def test_counts_three_reps(self) -> None:
        m = MovementMachine(config=SQUAT)
        events = feed(m, one_squat() * 3)
        assert events == [1, 2, 3]
        assert m.rep_count == 3

    def test_visits_all_four_states(self) -> None:
        m = MovementMachine(config=SQUAT)
        seen: set[MovementState] = set()
        t = 0.0
        for angle in one_squat():
            m.update(angle, tracking_valid=True, now=t)
            seen.add(m.state)
            t += 0.1
        assert MovementState.UP in seen
        assert MovementState.GOING_DOWN in seen
        assert MovementState.DOWN in seen
        assert MovementState.GOING_UP in seen


class TestIncreasingDirection:
    def test_shoulder_raise_counts(self) -> None:
        """Peak is a LARGER angle here - the inverted comparison must work."""
        m = MovementMachine(config=RAISE)
        sequence = hold(15) + ramp(15, 95) + hold(98) + ramp(95, 15) + hold(12)
        assert feed(m, sequence) == [1]

    def test_shoulder_raise_partial_not_counted(self) -> None:
        m = MovementMachine(config=RAISE)
        # Lifts to 60 degrees - past rest, short of the 85 peak - and lowers.
        sequence = hold(15) + ramp(15, 60) + hold(60) + ramp(60, 15) + hold(12)
        assert feed(m, sequence) == []
        assert m.rep_count == 0


class TestJitterRejection:
    def test_threshold_jitter_does_not_count(self) -> None:
        """The classic double-count bug: hovering on the rest threshold."""
        m = MovementMachine(config=SQUAT)
        jitter = [161, 159, 162, 158, 161, 157, 163, 159] * 4
        assert feed(m, hold(170) + jitter) == []
        assert m.rep_count == 0

    def test_peak_jitter_does_not_count_multiple(self) -> None:
        m = MovementMachine(config=SQUAT)
        sequence = (
            hold(170)
            + ramp(170, 95)
            + [99, 101, 98, 102, 97, 103, 99, 101]  # wobble across peak edge
            + ramp(95, 170)
            + hold(172)
        )
        assert feed(m, sequence) == [1]

    def test_single_stray_frame_ignored(self) -> None:
        """One wildly-wrong landmark must not advance the cycle (min dwell)."""
        m = MovementMachine(config=SQUAT)
        sequence = hold(170, 5) + [90] + hold(170, 5)
        assert feed(m, sequence) == []
        assert m.rep_count == 0


class TestPartialRepetitions:
    def test_half_rep_down_only_not_counted(self) -> None:
        m = MovementMachine(config=SQUAT)
        assert feed(m, hold(170) + ramp(170, 95) + hold(92)) == []

    def test_shallow_dip_not_counted(self) -> None:
        """Descends to 130 - never reaches the 100 peak - then stands."""
        m = MovementMachine(config=SQUAT)
        sequence = hold(170) + ramp(170, 130) + hold(130) + ramp(130, 170) + hold(172)
        assert feed(m, sequence) == []
        assert m.rep_count == 0


class TestTimingGuards:
    def test_cooldown_blocks_immediate_second_rep(self) -> None:
        """Isolates the cooldown guard from the minimum-duration guard.

        min_rep_duration is set low so each movement is individually valid;
        the long cooldown is therefore the only thing that can reject rep 2.
        """
        long_cooldown = MovementConfig(
            primary_angle="knee",
            direction=Direction.DECREASING,
            rest_angle=160.0,
            peak_angle=100.0,
            min_state_frames=2,
            cooldown_ms=5_000,
            min_rep_duration_ms=100,
            max_rep_duration_ms=20_000,
        )
        m = MovementMachine(config=long_cooldown)
        events = feed(m, one_squat() * 2, step=0.05)
        assert events == [1]
        assert m.rep_count == 1

    def test_second_rep_counts_once_cooldown_elapses(self) -> None:
        """The cooldown must expire, not permanently block counting."""
        m = MovementMachine(config=SQUAT)
        assert feed(m, one_squat(), step=0.05) == [1]
        # Resume well after the 300 ms cooldown window.
        assert feed(m, one_squat(), start=30.0, step=0.05) == [2]

    def test_rep_faster_than_human_rejected(self) -> None:
        """min_rep_duration_ms guards against noise masquerading as movement."""
        m = MovementMachine(config=SQUAT)
        assert feed(m, one_squat(), step=0.001) == []

    def test_abandoned_rep_rejected(self) -> None:
        """Patient pauses at the bottom for longer than max_rep_duration."""
        m = MovementMachine(config=SQUAT)
        slow = MovementConfig(
            primary_angle="knee",
            direction=Direction.DECREASING,
            rest_angle=160.0,
            peak_angle=100.0,
            min_state_frames=2,
            cooldown_ms=0,
            min_rep_duration_ms=100,
            max_rep_duration_ms=2_000,
        )
        m = MovementMachine(config=slow)
        sequence = hold(170) + ramp(170, 95) + hold(92, 40) + ramp(95, 170) + hold(172)
        assert feed(m, sequence, step=0.2) == []


class TestVisibilityGating:
    def test_frozen_while_tracking_invalid(self) -> None:
        m = MovementMachine(config=SQUAT)
        assert feed(m, one_squat(), tracking_valid=False) == []
        assert m.state is MovementState.IDLE
        assert m.rep_count == 0

    def test_resumes_after_brief_occlusion(self) -> None:
        """A patient briefly occluded mid-squat must not lose the repetition."""
        m = MovementMachine(config=SQUAT)
        t = 0.0

        def push(angles: list[float], valid: bool) -> list[int]:
            nonlocal t
            out = []
            for a in angles:
                e = m.update(a, tracking_valid=valid, now=t)
                if e:
                    out.append(e.rep_number)
                t += 0.1
            return out

        push(hold(170), True)
        push(ramp(170, 95), True)
        push(hold(92), False)  # occluded at the bottom
        push(hold(92), True)
        events = push(ramp(95, 170) + hold(172), True)
        assert events == [1]

    def test_none_angle_does_not_advance(self) -> None:
        m = MovementMachine(config=SQUAT)
        t = 0.0
        for _ in range(20):
            assert m.update(None, tracking_valid=True, now=t) is None
            t += 0.1
        assert m.rep_count == 0


class TestRestoration:
    def test_rep_count_seeds_from_backend(self) -> None:
        """After a pose-service restart the next rep must be 6, not 1."""
        m = MovementMachine(config=SQUAT, rep_count=5)
        assert feed(m, one_squat()) == [6]
        assert m.rep_count == 6

    def test_reset_cycle_preserves_rep_count(self) -> None:
        m = MovementMachine(config=SQUAT)
        feed(m, one_squat())
        assert m.rep_count == 1
        m.reset_cycle()
        assert m.rep_count == 1
        assert m.state is MovementState.IDLE

    def test_reset_cycle_discards_partial_movement(self) -> None:
        m = MovementMachine(config=SQUAT)
        feed(m, hold(170) + ramp(170, 95) + hold(92))
        m.reset_cycle()
        # Completing the "return" half alone must not produce a repetition.
        assert feed(m, ramp(95, 170) + hold(172), start=10.0) == []


class TestConfigParsing:
    def test_from_dict_roundtrip(self) -> None:
        cfg = MovementConfig.from_dict(
            {
                "primaryAngle": "knee",
                "direction": "DECREASING",
                "restAngle": 160,
                "peakAngle": 100,
                "hysteresisDeg": 8,
                "minStateFrames": 2,
                "cooldownMs": 600,
            }
        )
        assert cfg.primary_angle == "knee"
        assert cfg.direction is Direction.DECREASING
        assert cfg.rest_angle == 160.0

    def test_defaults_applied(self) -> None:
        cfg = MovementConfig.from_dict(
            {"primaryAngle": "elbow", "restAngle": 150, "peakAngle": 55}
        )
        assert cfg.direction is Direction.DECREASING
        assert cfg.hysteresis_deg == 8.0

    def test_invalid_direction_rejected(self) -> None:
        with pytest.raises(ValueError):
            MovementConfig.from_dict(
                {
                    "primaryAngle": "knee",
                    "direction": "SIDEWAYS",
                    "restAngle": 160,
                    "peakAngle": 100,
                }
            )
