"""Held-position exercises: the ones with nothing to count.

Two properties are under test throughout.

1. A HOLD exercise NEVER reports a repetition. Postural correction has no
   movement cycle, and the previous configuration invented one - which meant
   the only way to score a second "repetition" was to slouch between attempts.
   A patient who simply stands correctly must score the exercise, not zero.

2. The clock is honest. It runs only while the patient is genuinely aligned and
   genuinely visible, it survives a reconnect, and it cannot be advanced by a
   browser that stopped sending frames.
"""

from __future__ import annotations

import math

import pytest

from app.exercises.base import GoalType, RuleConfig
from app.exercises.registry import build_analyzer
from app.landmarks.registry import Keypoint, Landmark, PoseFrame
from app.state.hold import MAX_CREDITED_GAP_SECONDS, HoldTracker
from app.state.movement import MovementState

FRAME_W = 480
FRAME_H = 480


def build_posture_pose(
    *,
    spine_deg: float = 178.0,
    shoulder_drop_px: float = 0.0,
    hip_drop_px: float = 0.0,
    visibility: float = 0.95,
    hidden: tuple[Landmark, ...] = (),
) -> PoseFrame:
    """A standing skeleton whose spine angle is exactly ``spine_deg``.

    The spine angle is the interior angle at the hip midpoint on the path
    mid_shoulder -> mid_hip -> mid_knee. 180 is perfectly upright; the shoulders
    are tipped forward by the shortfall so the geometry is exact rather than
    approximate.

    ``shoulder_drop_px`` / ``hip_drop_px`` raise ONE side to make the pair
    uneven, which is what the alignment rules measure.
    """
    hip_y = 260.0
    knee_y = 400.0
    torso = 200.0
    origin_x = 240.0

    # mid_hip -> mid_knee points straight down. Rotate mid_hip -> mid_shoulder
    # away from straight up by (180 - spine_deg).
    tilt = math.radians(180.0 - spine_deg)
    shoulder_x = origin_x + torso * math.sin(tilt)
    shoulder_y = hip_y - torso * math.cos(tilt)

    points = {
        Landmark.LEFT_SHOULDER: (shoulder_x - 60.0, shoulder_y + shoulder_drop_px),
        Landmark.RIGHT_SHOULDER: (shoulder_x + 60.0, shoulder_y),
        Landmark.LEFT_HIP: (origin_x - 36.0, hip_y + hip_drop_px),
        Landmark.RIGHT_HIP: (origin_x + 36.0, hip_y),
        Landmark.LEFT_KNEE: (origin_x - 36.0, knee_y),
        Landmark.RIGHT_KNEE: (origin_x + 36.0, knee_y),
    }

    pixels: dict[Landmark, Keypoint] = {}
    normalized: dict[Landmark, Keypoint] = {}
    for landmark, (x, y) in points.items():
        confidence = 0.0 if landmark in hidden else visibility
        pixels[landmark] = Keypoint(x=x, y=y, confidence=confidence)
        normalized[landmark] = Keypoint(
            x=x / FRAME_W, y=y / FRAME_H, confidence=confidence
        )

    return PoseFrame(
        pixels=pixels, normalized=normalized, width=FRAME_W, height=FRAME_H
    )


POSTURE_RULES = {
    "exerciseSlug": "static-posture",
    "ruleConfigVersion": 2,
    "goalType": "HOLD",
    "targetHoldSeconds": 10.0,
    "requiredLandmarks": [
        "left_shoulder", "right_shoulder",
        "left_hip", "right_hip",
        "left_knee", "right_knee",
    ],
    "angleDefinitions": {
        "spine": {"type": "joint", "a": "mid_shoulder", "b": "mid_hip", "c": "mid_knee"},
        "shoulderAlignment": {"type": "gap_y", "a": "left_shoulder", "b": "right_shoulder"},
        "hipAlignment": {"type": "gap_y", "a": "left_hip", "b": "right_hip"},
    },
    # No movementStateConfig. That is the point.
    "postureRules": [
        {"code": "SHOULDER_ALIGNMENT", "angle": "shoulderAlignment", "when": "always", "max": 20, "joint": "shoulder"},
        {"code": "HIP_ALIGNMENT", "angle": "hipAlignment", "when": "always", "max": 20, "joint": "hip"},
        {"code": "SPINE_ALIGNMENT", "angle": "spine", "when": "always", "min": 165, "joint": "spine"},
    ],
    "minVisibility": 0.5,
    "repCorrectnessThreshold": 70,
    "smoothingWindow": 1,
}


@pytest.fixture
def analyzer():
    return build_analyzer(RuleConfig.from_payload(POSTURE_RULES))


class TestRuleConfig:
    def test_hold_config_needs_no_movement_cycle(self) -> None:
        """The whole point: a posture exercise declares no thresholds."""
        config = RuleConfig.from_payload(POSTURE_RULES)
        assert config.goal_type is GoalType.HOLD
        assert config.counts_reps is False
        assert config.target_hold_seconds == 10.0

    def test_rep_config_still_requires_one(self) -> None:
        """A REPS exercise without a movement config is broken, not defaulted.

        Silently supplying thresholds would produce an exercise that counts
        nothing and reports no error, which is the failure mode hardest to
        notice.
        """
        rules = {**POSTURE_RULES, "goalType": "REPS"}
        with pytest.raises(KeyError):
            RuleConfig.from_payload(rules)

    def test_defaults_to_reps_when_unspecified(self) -> None:
        """An older backend that sends no goalType must behave as before."""
        rules = {k: v for k, v in POSTURE_RULES.items() if k != "goalType"}
        rules["movementStateConfig"] = {
            "primaryAngle": "spine",
            "direction": "INCREASING",
            "restAngle": 150,
            "peakAngle": 170,
        }
        assert RuleConfig.from_payload(rules).goal_type is GoalType.REPS


class TestNoRepetitionsAreCounted:
    def test_perfect_posture_counts_no_reps(self, analyzer) -> None:
        for _ in range(60):
            result = analyzer.analyze(build_posture_pose(), people_detected=1)
        assert result.rep_count == 0
        assert result.rep_event is None

    def test_slouch_and_straighten_counts_no_reps(self, analyzer) -> None:
        """The movement the old config called a repetition. It is not one."""
        for _ in range(5):
            for spine in (140.0, 150.0, 160.0, 172.0, 178.0):
                result = analyzer.analyze(
                    build_posture_pose(spine_deg=spine), people_detected=1
                )
        assert result.rep_count == 0

    def test_movement_machine_is_never_advanced(self, analyzer) -> None:
        for _ in range(20):
            analyzer.analyze(build_posture_pose(), people_detected=1)
        assert analyzer.machine.state is MovementState.IDLE
        assert analyzer.machine.rep_count == 0


class TestHoldStates:
    def test_correct_posture_reports_holding(self, analyzer) -> None:
        analyzer.analyze(build_posture_pose(), people_detected=1)
        result = analyzer.analyze(build_posture_pose(), people_detected=1)
        assert result.movement_state is MovementState.HOLDING
        assert result.hold is not None
        assert result.hold.active is True

    def test_bad_spine_stops_the_clock_and_says_why(self, analyzer) -> None:
        result = analyzer.analyze(
            build_posture_pose(spine_deg=150.0), people_detected=1
        )
        assert result.movement_state is MovementState.IDLE
        assert result.hold is not None
        assert result.hold.active is False
        # The guidance is the product here, not a side effect.
        assert "SPINE_ALIGNMENT" in {e.code.value for e in result.errors}

    def test_uneven_shoulders_are_reported(self, analyzer) -> None:
        result = analyzer.analyze(
            build_posture_pose(shoulder_drop_px=40.0), people_detected=1
        )
        assert "SHOULDER_ALIGNMENT" in {e.code.value for e in result.errors}
        assert result.hold is not None and result.hold.active is False

    def test_uneven_hips_are_reported(self, analyzer) -> None:
        result = analyzer.analyze(
            build_posture_pose(hip_drop_px=40.0), people_detected=1
        )
        assert "HIP_ALIGNMENT" in {e.code.value for e in result.errors}

    def test_no_person_stops_the_clock(self, analyzer) -> None:
        analyzer.analyze(build_posture_pose(), people_detected=1)
        result = analyzer.analyze(None, people_detected=0)
        assert result.hold is not None
        assert result.hold.active is False
        assert result.movement_state is MovementState.IDLE


class TestHoldTracker:
    def test_accrues_only_while_aligned_and_visible(self) -> None:
        tracker = HoldTracker(target_seconds=10.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.2)
        assert tracker.held_seconds == pytest.approx(0.2)

        # Misaligned: the clock stops, the earned time stays.
        tracker.update(aligned=False, tracking_valid=True, now=0.4)
        assert tracker.held_seconds == pytest.approx(0.2)

        # Out of frame: also stopped, for a different reason.
        tracker.update(aligned=True, tracking_valid=False, now=0.6)
        assert tracker.held_seconds == pytest.approx(0.2)

    def test_time_accumulates_across_interruptions(self) -> None:
        """Corrective work is expected to be interrupted - that IS the drill.

        Requiring one unbroken stretch would fail the exact patient the
        exercise is prescribed for.
        """
        tracker = HoldTracker(target_seconds=1.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.5)
        tracker.update(aligned=False, tracking_valid=True, now=0.7)
        tracker.update(aligned=True, tracking_valid=True, now=0.9)
        tracker.update(aligned=True, tracking_valid=True, now=1.4)

        assert tracker.held_seconds == pytest.approx(1.0)
        assert tracker.goal_reached is True

    def test_streak_resets_but_best_is_remembered(self) -> None:
        tracker = HoldTracker(target_seconds=10.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.5)
        snapshot = tracker.update(aligned=False, tracking_valid=True, now=0.6)

        assert snapshot.streak_seconds == 0.0
        assert snapshot.best_streak_seconds == pytest.approx(0.5)

    def test_a_stalled_socket_cannot_be_credited(self) -> None:
        """A backgrounded tab must not earn the goal while nothing is watched.

        Without a cap, minimising the browser mid-hold and returning a minute
        later would credit the whole minute.
        """
        tracker = HoldTracker(target_seconds=10.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.0)
        tracker.update(aligned=True, tracking_valid=True, now=60.0)

        assert tracker.held_seconds == pytest.approx(MAX_CREDITED_GAP_SECONDS)
        assert tracker.goal_reached is False

    def test_resumes_from_credited_time(self) -> None:
        """A dropped socket must not cost the patient what they already did."""
        tracker = HoldTracker(target_seconds=10.0, held_seconds=8.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.5)
        assert tracker.held_seconds == pytest.approx(8.5)

    def test_reset_cycle_keeps_earned_time(self) -> None:
        tracker = HoldTracker(target_seconds=10.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.5)
        tracker.reset_cycle()
        assert tracker.held_seconds == pytest.approx(0.5)

        # The gap across the reconnect is not credited: the clock restarts.
        tracker.update(aligned=True, tracking_valid=True, now=100.0)
        assert tracker.held_seconds == pytest.approx(0.5)

    def test_goal_never_reached_without_a_target(self) -> None:
        """A therapist who left the duration blank must not auto-complete.

        Zero would otherwise mean "already finished" and close the session on
        the first frame.
        """
        tracker = HoldTracker(target_seconds=0.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.0)
        tracker.update(aligned=True, tracking_valid=True, now=0.5)
        assert tracker.goal_reached is False


class TestHoldSummary:
    def test_summary_is_non_destructive(self, analyzer) -> None:
        """It is read repeatedly during a session and must not drain itself.

        A repetition exercise flushes per rep; a hold exercise has no slices,
        so the same accumulator runs for the whole session.
        """
        for _ in range(10):
            analyzer.analyze(build_posture_pose(), people_detected=1)

        first = analyzer.hold_summary()
        second = analyzer.hold_summary()
        assert first["analysedFrames"] == second["analysedFrames"] == 10
        assert first["meanScore"] == second["meanScore"]

    def test_summary_records_the_faults_that_blocked_the_hold(
        self, analyzer
    ) -> None:
        for _ in range(6):
            analyzer.analyze(
                build_posture_pose(spine_deg=150.0), people_detected=1
            )
        codes = {entry["code"] for entry in analyzer.hold_summary()["errors"]}
        assert "SPINE_ALIGNMENT" in codes

    def test_reset_cycle_preserves_the_session_summary(self, analyzer) -> None:
        """A reconnect must not erase the report.

        A rep exercise can afford to clear its accumulator - finished
        repetitions are already persisted. A hold exercise's accumulator IS the
        report, so clearing it would lose the session.
        """
        for _ in range(10):
            analyzer.analyze(build_posture_pose(), people_detected=1)
        analyzer.reset_cycle()
        assert analyzer.hold_summary()["analysedFrames"] == 10

    def test_rep_analyzer_refuses_a_hold_summary(self) -> None:
        rules = {
            **POSTURE_RULES,
            "goalType": "REPS",
            "movementStateConfig": {
                "primaryAngle": "spine",
                "direction": "INCREASING",
                "restAngle": 150,
                "peakAngle": 170,
            },
        }
        analyzer = build_analyzer(RuleConfig.from_payload(rules))
        with pytest.raises(RuntimeError):
            analyzer.hold_summary()
