"""Movement state machine and repetition counting.

This is the module that turns "the knee angle is currently 88 degrees" into
"that was repetition 6". It is the direct descendant of the gesture `if/elif`
ladder in the original hand-tracking prototype - the difference, and the whole
point, is that this classifier remembers the previous state.

Why a state machine at all
--------------------------
A repetition is not "a correct frame was seen". Counting per-frame, or on a
single threshold crossing, produces two well-known failure modes that both
existed in the superseded prototypes:

* **Jitter double-counting.** Pose estimates wobble a few degrees. An angle
  hovering at the threshold crosses it repeatedly, adding several repetitions
  for one movement. Fixed here by *hysteresis*: the angle must travel past the
  threshold by an extra margin before the state flips back.
* **Half repetitions.** Going down and stopping counts as a rep if you only
  watch one boundary. Fixed here by requiring the full cycle
  UP -> GOING_DOWN -> DOWN -> GOING_UP -> UP.

Three further guards:

* **Minimum dwell** - a state must persist for N consecutive frames before it
  is accepted, so one stray landmark cannot advance the cycle.
* **Cooldown** - a short refractory period after each counted repetition.
* **Visibility gating** - the machine is frozen entirely while required
  landmarks are not reliably visible, so walking out of frame never advances it.

Naming
------
The wire values follow the project's API contract:
  ``UP``          - the rest / start position
  ``GOING_DOWN``  - travelling toward the peak of the movement
  ``DOWN``        - the peak of the movement
  ``GOING_UP``    - returning to rest

For a squat these read literally. For a bicep curl, ``DOWN`` is the *curled*
position and for a shoulder raise it is the *raised* position: in both cases it
means "peak of the movement", not "physically lower". ``direction`` in the rule
config records which way the angle actually travels.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class MovementState(str, Enum):
    IDLE = "IDLE"
    UP = "UP"
    GOING_DOWN = "GOING_DOWN"
    DOWN = "DOWN"
    GOING_UP = "GOING_UP"
    #: HOLD exercises only. There is no movement cycle to be at a point in, so
    #: the state simply says whether the patient is correctly aligned right
    #: now. Never produced by MovementMachine - see HoldTracker.
    HOLDING = "HOLDING"


class Direction(str, Enum):
    """Which way the primary angle moves from rest toward the peak."""

    #: Squat, bicep curl - the joint flexes, so the angle gets smaller.
    DECREASING = "DECREASING"
    #: Shoulder raise - the arm lifts away from the body, angle gets larger.
    INCREASING = "INCREASING"


@dataclass(frozen=True, slots=True)
class MovementConfig:
    """Thresholds for one exercise, supplied by ExerciseRuleConfig.

    Every value here is a PROTOTYPE DEFAULT requiring physiotherapist review.
    None of them are clinical standards.
    """

    primary_angle: str
    direction: Direction
    rest_angle: float
    peak_angle: float
    hysteresis_deg: float = 8.0
    min_state_frames: int = 2
    cooldown_ms: int = 600
    min_rep_duration_ms: int = 700
    max_rep_duration_ms: int = 20_000

    @staticmethod
    def from_dict(raw: dict) -> "MovementConfig":
        return MovementConfig(
            primary_angle=str(raw["primaryAngle"]),
            direction=Direction(str(raw.get("direction", "DECREASING"))),
            rest_angle=float(raw["restAngle"]),
            peak_angle=float(raw["peakAngle"]),
            hysteresis_deg=float(raw.get("hysteresisDeg", 8.0)),
            min_state_frames=int(raw.get("minStateFrames", 2)),
            cooldown_ms=int(raw.get("cooldownMs", 600)),
            min_rep_duration_ms=int(raw.get("minRepDurationMs", 700)),
            max_rep_duration_ms=int(raw.get("maxRepDurationMs", 20_000)),
        )


@dataclass(slots=True)
class RepEvent:
    """Emitted exactly once per completed, accepted repetition."""

    rep_number: int
    started_at: float
    completed_at: float

    @property
    def duration_ms(self) -> float:
        return (self.completed_at - self.started_at) * 1000.0


@dataclass(slots=True)
class MovementMachine:
    """Stateful per-session repetition detector.

    One instance per live session. Never shared: the superseded FastAPI
    prototype held a single module-level analyzer, so two concurrent patients
    incremented the same counter.
    """

    config: MovementConfig
    #: Seeded from the backend on connect, so a pose-service restart mid-session
    #: resumes at rep 6 rather than restarting at rep 1.
    rep_count: int = 0

    state: MovementState = MovementState.IDLE
    _candidate: MovementState = MovementState.IDLE
    _candidate_frames: int = 0
    _state_entered_at: float = field(default_factory=time.monotonic)
    _rep_started_at: Optional[float] = None
    #: None until the first repetition completes. Must NOT default to 0.0:
    #: that reads as "a rep just happened at t=0" and silently suppresses the
    #: first repetition whenever the cooldown exceeds the elapsed clock time.
    _last_rep_at: Optional[float] = None
    #: Guards against counting a rep from a cycle that never reached the peak.
    _reached_peak: bool = False

    # -- threshold helpers --------------------------------------------------

    def _at_rest(self, angle: float) -> bool:
        if self.config.direction is Direction.DECREASING:
            return angle >= self.config.rest_angle
        return angle <= self.config.rest_angle

    def _left_rest(self, angle: float) -> bool:
        """Hysteresis band: must clear the threshold by an extra margin."""
        h = self.config.hysteresis_deg
        if self.config.direction is Direction.DECREASING:
            return angle < self.config.rest_angle - h
        return angle > self.config.rest_angle + h

    def _at_peak(self, angle: float) -> bool:
        if self.config.direction is Direction.DECREASING:
            return angle <= self.config.peak_angle
        return angle >= self.config.peak_angle

    def _left_peak(self, angle: float) -> bool:
        h = self.config.hysteresis_deg
        if self.config.direction is Direction.DECREASING:
            return angle > self.config.peak_angle + h
        return angle < self.config.peak_angle - h

    # -- main update --------------------------------------------------------

    def update(
        self,
        angle: Optional[float],
        *,
        tracking_valid: bool,
        now: Optional[float] = None,
    ) -> Optional[RepEvent]:
        """Advance the machine by one frame.

        Returns a RepEvent on the frame a repetition completes, else ``None``.

        The machine is FROZEN when tracking is invalid or the angle is not
        measurable: the state is preserved but no transition occurs. Freezing
        rather than resetting is deliberate - a patient briefly occluded
        mid-squat should resume, not lose the repetition.
        """
        now = now if now is not None else time.monotonic()

        if not tracking_valid or angle is None:
            self._candidate_frames = 0
            return None

        target = self._classify(angle)
        if target is None:
            return None

        # --- minimum dwell: N consecutive frames agreeing before we move ---
        if target is self._candidate:
            self._candidate_frames += 1
        else:
            self._candidate = target
            self._candidate_frames = 1

        if self._candidate_frames < self.config.min_state_frames:
            return None
        if target is self.state:
            return None

        return self._transition(target, now)

    def _classify(self, angle: float) -> Optional[MovementState]:
        """Map the current angle to the state it implies."""
        if self._at_rest(angle):
            return MovementState.UP
        if self._at_peak(angle):
            return MovementState.DOWN

        # Between the bands: the direction of travel is inferred from where we
        # came from, which is why hysteresis exit checks matter here.
        if self.state in (MovementState.UP, MovementState.GOING_DOWN):
            return MovementState.GOING_DOWN if self._left_rest(angle) else None
        if self.state in (MovementState.DOWN, MovementState.GOING_UP):
            return MovementState.GOING_UP if self._left_peak(angle) else None
        # From IDLE, an intermediate angle is ambiguous - wait for a clear
        # rest or peak reading before starting to track.
        return None

    def _transition(
        self, target: MovementState, now: float
    ) -> Optional[RepEvent]:
        previous = self.state
        self.state = target
        self._state_entered_at = now

        # Leaving rest toward the peak begins a repetition attempt.
        if target is MovementState.GOING_DOWN and previous in (
            MovementState.UP,
            MovementState.IDLE,
        ):
            self._rep_started_at = now
            self._reached_peak = False
            return None

        if target is MovementState.DOWN:
            # Reaching the peak straight from rest (a fast movement that
            # skipped the intermediate band) still starts the attempt.
            if self._rep_started_at is None:
                self._rep_started_at = now
            self._reached_peak = True
            return None

        if target is MovementState.UP and previous is MovementState.GOING_UP:
            return self._try_complete(now)

        return None

    def _try_complete(self, now: float) -> Optional[RepEvent]:
        """Apply the final guards and count the repetition if it survives."""
        started = self._rep_started_at
        self._rep_started_at = None

        if not self._reached_peak or started is None:
            # A partial movement: went down a little and came back up.
            self._reached_peak = False
            return None
        self._reached_peak = False

        # Cooldown - refractory period after the previous accepted repetition.
        # Skipped entirely for the first rep, which has no predecessor.
        if (
            self._last_rep_at is not None
            and (now - self._last_rep_at) * 1000.0 < self.config.cooldown_ms
        ):
            return None

        duration_ms = (now - started) * 1000.0
        if duration_ms < self.config.min_rep_duration_ms:
            # Faster than a human can perform the movement: almost certainly
            # tracking noise rather than a repetition.
            return None
        if duration_ms > self.config.max_rep_duration_ms:
            # The patient paused mid-movement for a long time. Not noise, but
            # not a clean repetition either - discarded rather than recorded
            # with a misleading duration.
            return None

        self.rep_count += 1
        self._last_rep_at = now
        return RepEvent(
            rep_number=self.rep_count,
            started_at=started,
            completed_at=now,
        )

    # -- lifecycle ----------------------------------------------------------

    def state_held_ms(self, now: Optional[float] = None) -> float:
        now = now if now is not None else time.monotonic()
        return max(0.0, (now - self._state_entered_at) * 1000.0)

    def reset_cycle(self) -> None:
        """Clear the in-progress movement WITHOUT touching the rep count.

        Used on reconnect and between sets: the partially-completed movement is
        meaningless after a gap, but repetitions already persisted by the
        backend must never be replayed.
        """
        self.state = MovementState.IDLE
        self._candidate = MovementState.IDLE
        self._candidate_frames = 0
        self._rep_started_at = None
        self._reached_peak = False
        self._state_entered_at = time.monotonic()
