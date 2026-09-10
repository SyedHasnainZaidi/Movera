"""Data-driven exercise analysis.

Structure ported from `analysis/base.py` in the project's YOLO/FastAPI
prototype - required joints, reset, score accumulation and a uniform result
shape. Two things changed in the migration:

1. **Thresholds moved out of the class body into the database.** The prototype
   hard-coded `if knee_angle > 160` inside SquatAnalyzer. Here every angle
   definition, state threshold and posture rule arrives as JSON from
   `ExerciseRuleConfig`, so a physiotherapist can tune the system without a
   code change, and a session records which rule *version* it was judged by.

2. **Repetition counting is guarded.** The prototype's `_update_rep_counter`
   flipped on a bare `prev_state -> new_state` comparison with no hysteresis,
   no dwell requirement and no cooldown, so pose jitter around a threshold
   counted several repetitions for one movement. That is handled by
   MovementMachine instead; the prototype's THRESHOLDS are preserved exactly,
   its transition logic is not.

Angles are computed in image-pixel space, which is what YOLOv8 returns and what
the prototype's thresholds were tuned against.

Adding an exercise should require a seed row, not a new Python class, unless it
needs a genuinely novel rule that cannot be expressed declaratively.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Optional, Sequence

from app.feedback.codes import (
    CATALOGUE,
    TRACKING_CODES,
    DetectedError,
    ErrorCode,
    Severity,
    build_error,
    penalty_for,
)
from app.geometry.angles import (
    angle_between,
    angle_from_vertical,
    average_angle,
    clamp,
    horizontal_distance,
    midpoint,
    to_reference_scale,
    vertical_distance,
)
from app.geometry.smoothing import AngleSmoother, AngleTracker
from app.landmarks.registry import Keypoint, Landmark, PoseFrame, parse_landmark
from app.state.hold import HoldSnapshot, HoldTracker
from app.state.movement import (
    Direction,
    MovementConfig,
    MovementMachine,
    MovementState,
    RepEvent,
)


class GoalType(str, Enum):
    """How this exercise decides it is finished.

    Mirrors the backend's ExerciseGoalType enum. The value arrives with the
    analyzer context, so the pose service never has to guess from the slug.
    """

    #: Countable movement cycles. MovementMachine drives completion.
    REPS = "REPS"
    #: A sustained position with nothing to count. HoldTracker drives it.
    HOLD = "HOLD"

#: Angle definition types that combine OTHER named angles rather than
#: measuring landmarks directly. Evaluated in a second pass.
#:
#:   average - both sides move together (squat: the knees flex as a pair)
#:   min     - the most-flexed side drives the movement. Required for any
#:             single-limb exercise with direction DECREASING, e.g. a bicep
#:             curl. Averaging there is a bug: one arm curled to 50 degrees
#:             beside one resting at 170 averages to 110, which never crosses
#:             a 55-degree peak threshold, so no repetition can ever complete.
#:   max     - the most-extended side drives the movement. The equivalent for
#:             direction INCREASING, e.g. a single-arm shoulder raise.
#:   ratio   - one measurement divided by another, for rules that compare two
#:             distances rather than test one against a constant. The squat's
#:             knee-alignment check is exactly this: the prototype wrote
#:             `knee_width < ankle_width * 0.7`, which is a ratio below 0.7 and
#:             cannot be expressed as a fixed threshold, because both distances
#:             depend on how far away the patient is standing.
COMBINING_TYPES: frozenset[str] = frozenset(
    {"average", "min", "max", "ratio"}
)

#: Virtual landmarks derived from two real ones.
VIRTUAL_POINTS: Mapping[str, tuple[Landmark, Landmark]] = {
    "mid_shoulder": (Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER),
    "mid_hip": (Landmark.LEFT_HIP, Landmark.RIGHT_HIP),
    "mid_knee": (Landmark.LEFT_KNEE, Landmark.RIGHT_KNEE),
    "mid_ankle": (Landmark.LEFT_ANKLE, Landmark.RIGHT_ANKLE),
}


def _ratio(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    """numerator / denominator, or None when it is not meaningful.

    A near-zero denominator is treated as unmeasurable rather than producing an
    enormous ratio: ankles photographed exactly in line give an ankle width of
    ~0, and dividing by it would fire the knee-alignment rule on every frame.
    """
    if numerator is None or denominator is None:
        return None
    if abs(denominator) < 1e-6:
        return None
    value = numerator / denominator
    return value if math.isfinite(value) else None


#: Placeholder thresholds for HOLD exercises, which have no movement cycle.
#:
#: RuleConfig.movement is not optional - too much code reads it - so a HOLD
#: config gets this instead. It is never fed to a MovementMachine: analyze()
#: takes the hold path and never calls machine.update. The angle name is
#: deliberately one that cannot exist, so anything that DOES reach for it fails
#: loudly rather than quietly counting repetitions against a real joint.
_UNUSED_MOVEMENT_CONFIG = MovementConfig(
    primary_angle="__no_movement_cycle__",
    direction=Direction.DECREASING,
    rest_angle=0.0,
    peak_angle=0.0,
)


@dataclass(frozen=True, slots=True)
class RuleConfig:
    """Parsed ExerciseRuleConfig, exactly as the backend supplied it."""

    exercise_slug: str
    version: int
    required_landmarks: tuple[Landmark, ...]
    angle_definitions: Mapping[str, Mapping[str, Any]]
    movement: MovementConfig
    posture_rules: tuple[Mapping[str, Any], ...]
    min_visibility: float
    rep_correctness_threshold: float
    smoothing_window: int = 5
    #: REPS unless the backend says otherwise. Defaulting this way means an
    #: older backend that does not send the field still behaves exactly as it
    #: did, rather than silently disabling repetition counting.
    goal_type: GoalType = GoalType.REPS
    #: Seconds of correct alignment prescribed. Meaningful only for HOLD.
    target_hold_seconds: float = 0.0

    @property
    def counts_reps(self) -> bool:
        return self.goal_type is GoalType.REPS

    @staticmethod
    def from_payload(payload: Mapping[str, Any]) -> "RuleConfig":
        raw_landmarks = payload.get("requiredLandmarks") or []
        landmarks: list[Landmark] = []
        for name in raw_landmarks:
            parsed = parse_landmark(str(name))
            if parsed is None:
                raise ValueError(f"Unknown landmark in rule config: {name!r}")
            landmarks.append(parsed)

        goal_type = GoalType(str(payload.get("goalType", GoalType.REPS.value)))

        # A HOLD exercise has no movement cycle, so it is not required to
        # declare thresholds for one. REPS exercises still must: a missing
        # movementStateConfig there is a broken configuration, not a default.
        raw_movement = payload.get("movementStateConfig")
        if raw_movement:
            movement = MovementConfig.from_dict(dict(raw_movement))
        elif goal_type is GoalType.HOLD:
            movement = _UNUSED_MOVEMENT_CONFIG
        else:
            raise KeyError("movementStateConfig")

        return RuleConfig(
            exercise_slug=str(payload["exerciseSlug"]),
            version=int(payload.get("ruleConfigVersion", 1)),
            required_landmarks=tuple(landmarks),
            angle_definitions=dict(payload.get("angleDefinitions") or {}),
            movement=movement,
            goal_type=goal_type,
            target_hold_seconds=float(payload.get("targetHoldSeconds", 0.0) or 0.0),
            posture_rules=tuple(payload.get("postureRules") or []),
            min_visibility=float(payload.get("minVisibility", 0.5)),
            rep_correctness_threshold=float(
                payload.get("repCorrectnessThreshold", 70.0)
            ),
            smoothing_window=int(payload.get("smoothingWindow", 5)),
        )


@dataclass(slots=True)
class FrameAnalysis:
    """Everything computed for one frame."""

    tracking_valid: bool
    confidence: float
    angles: dict[str, float]
    missing_landmarks: list[str]
    movement_state: MovementState
    state_held_ms: float
    posture_correct: bool
    posture_score: float
    errors: list[DetectedError]
    rep_event: Optional[RepEvent] = None
    rep_count: int = 0
    #: HOLD exercises only; None for everything that counts repetitions.
    #:
    #: Whether the session's GOAL has been met is deliberately not decided
    #: here: that needs the prescription, which lives on the session context.
    #: See LiveSession.goal_reached().
    hold: Optional[HoldSnapshot] = None


@dataclass(slots=True)
class RepAccumulator:
    """Per-repetition running totals, flushed when a repetition completes."""

    frame_scores: list[float] = field(default_factory=list)
    confidences: list[float] = field(default_factory=list)
    error_counts: dict[ErrorCode, int] = field(default_factory=dict)
    angles: AngleTracker = field(default_factory=AngleTracker)

    def observe(
        self,
        score: float,
        confidence: float,
        errors: Sequence[DetectedError],
        angles: Mapping[str, float],
    ) -> None:
        self.frame_scores.append(score)
        self.confidences.append(confidence)
        for error in errors:
            self.error_counts[error.code] = self.error_counts.get(error.code, 0) + 1
        for name, value in angles.items():
            self.angles.observe(name, value)

    def mean_score(self) -> float:
        if not self.frame_scores:
            return 0.0
        return sum(self.frame_scores) / len(self.frame_scores)

    def mean_confidence(self) -> float:
        if not self.confidences:
            return 0.0
        return sum(self.confidences) / len(self.confidences)

    @property
    def frames(self) -> int:
        return len(self.frame_scores)

    def reset(self) -> None:
        self.frame_scores.clear()
        self.confidences.clear()
        self.error_counts.clear()
        self.angles.reset()


class BaseExerciseAnalyzer:
    """Stateful analyzer for ONE live session.

    Never shared between sessions: the movement machine, the smoother and the
    repetition accumulator are all per-patient state.
    """

    def __init__(
        self,
        config: RuleConfig,
        initial_rep_count: int = 0,
        initial_held_seconds: float = 0.0,
    ) -> None:
        self.config = config
        self.smoother = AngleSmoother(window=config.smoothing_window)
        self.machine = MovementMachine(
            config=config.movement, rep_count=initial_rep_count
        )
        self.accumulator = RepAccumulator()

        # HOLD exercises accumulate into the same RepAccumulator, but it is
        # never flushed: with no repetitions to divide the session into, the
        # accumulator IS the session summary and is read non-destructively.
        self.hold: Optional[HoldTracker] = (
            HoldTracker(
                target_seconds=config.target_hold_seconds,
                held_seconds=initial_held_seconds,
            )
            if config.goal_type is GoalType.HOLD
            else None
        )

    @property
    def counts_reps(self) -> bool:
        return self.hold is None

    @property
    def rep_count(self) -> int:
        """Repetitions counted so far. Always 0 for a HOLD exercise.

        Reading through this rather than through `machine.rep_count` is what
        guarantees a hold exercise can never report a repetition it did not
        count - the machine is simply never advanced in that mode, but a future
        caller reaching for it directly would get a plausible-looking zero
        instead of an obvious one.
        """
        return 0 if self.hold is not None else self.machine.rep_count

    # -- landmark access ----------------------------------------------------

    def _resolve_point(self, frame: PoseFrame, name: str) -> Optional[Keypoint]:
        """Resolve a real or virtual joint, in image-pixel coordinates.

        Always pixels. The MediaPipe version chose between a `world` and a
        `normalized` space per rule; YOLOv8 has neither - it returns pixels and
        nothing else - so any `"space"` key left in an inherited rule config is
        ignored rather than silently selecting a coordinate system that does
        not exist.
        """
        if name in VIRTUAL_POINTS:
            left, right = VIRTUAL_POINTS[name]
            return midpoint(frame.pixels.get(left), frame.pixels.get(right))

        landmark = parse_landmark(name)
        if landmark is None:
            return None
        return frame.pixels.get(landmark)

    def check_visibility(self, frame: PoseFrame) -> tuple[bool, list[str], float]:
        """Gate analysis on the landmarks this exercise actually needs.

        Returns (is_valid, missing_names, confidence).

        Confidence is the MEAN visibility of required landmarks - documented
        explicitly because it is easy to misread. It measures how well the
        camera can see the patient. It is NOT an accuracy figure, and it says
        nothing about whether the exercise was performed correctly.
        """
        missing: list[str] = []
        visibilities: list[float] = []

        for landmark in self.config.required_landmarks:
            visibility = frame.visibility_of(landmark)
            visibilities.append(visibility)
            if visibility < self.config.min_visibility:
                missing.append(landmark.value)

        confidence = (
            sum(visibilities) / len(visibilities) if visibilities else 0.0
        )
        return (not missing), missing, confidence

    # -- angle computation --------------------------------------------------

    def compute_angles(self, frame: PoseFrame) -> dict[str, Optional[float]]:
        """Evaluate every angle declared in the rule config.

        Supported definition types:
          joint    - interior angle at ``b`` on the path a -> b -> c
          vertical - tilt of ``lower -> upper`` away from gravity
          average  - mean of other named angles (left/right pairs)
          gap_x / gap_y - absolute separation, for alignment rules
        """
        results: dict[str, Optional[float]] = {}

        # Two passes so a combining type can reference angles defined after it.
        deferred: list[tuple[str, Mapping[str, Any]]] = []

        for name, definition in self.config.angle_definitions.items():
            kind = str(definition.get("type", "joint"))
            if kind in COMBINING_TYPES:
                deferred.append((name, definition))
                continue
            results[name] = self._compute_single(frame, definition, kind)

        for name, definition in deferred:
            kind = str(definition.get("type", "average"))

            if kind == "ratio":
                results[name] = _ratio(
                    results.get(str(definition.get("numerator", ""))),
                    results.get(str(definition.get("denominator", ""))),
                )
                continue

            parts = [results.get(str(ref)) for ref in definition.get("of", [])]
            measured = [p for p in parts if p is not None]

            if not measured:
                results[name] = None
            elif kind == "min":
                results[name] = min(measured)
            elif kind == "max":
                results[name] = max(measured)
            else:
                results[name] = average_angle(*parts)

        return results

    def _compute_single(
        self, frame: PoseFrame, definition: Mapping[str, Any], kind: str
    ) -> Optional[float]:
        if kind == "joint":
            return angle_between(
                self._resolve_point(frame, str(definition["a"])),
                self._resolve_point(frame, str(definition["b"])),
                self._resolve_point(frame, str(definition["c"])),
            )

        if kind == "vertical":
            return angle_from_vertical(
                self._resolve_point(frame, str(definition["upper"])),
                self._resolve_point(frame, str(definition["lower"])),
            )

        # gap_x / gap_y are DISTANCES, not angles, so unlike an angle they do
        # change with frame size. They are converted into the 640-wide
        # reference frame the prototype's pixel thresholds were written for -
        # see PIXEL_REFERENCE_WIDTH. Without this, the browser's 480-wide
        # frames would make every alignment rule fire about 25% too easily.
        if kind == "gap_x":
            return to_reference_scale(
                horizontal_distance(
                    self._resolve_point(frame, str(definition["a"])),
                    self._resolve_point(frame, str(definition["b"])),
                ),
                frame.width,
            )

        if kind == "gap_y":
            return to_reference_scale(
                vertical_distance(
                    self._resolve_point(frame, str(definition["a"])),
                    self._resolve_point(frame, str(definition["b"])),
                ),
                frame.width,
            )

        return None

    # -- posture rules ------------------------------------------------------

    def evaluate_posture(
        self, angles: Mapping[str, Optional[float]], state: MovementState
    ) -> list[DetectedError]:
        """Apply the declarative posture rules for the current state.

        A rule fires when its angle falls outside [min, max] while its ``when``
        condition holds. Rules whose angle is not measurable this frame are
        skipped, never treated as failures - an unmeasurable joint is a tracking
        problem, not bad technique.
        """
        errors: list[DetectedError] = []

        for rule in self.config.posture_rules:
            if not self._rule_applies(rule, state):
                continue

            angle_name = str(rule.get("angle", ""))
            observed = angles.get(angle_name)
            if observed is None:
                continue

            minimum = rule.get("min")
            maximum = rule.get("max")
            violated = (minimum is not None and observed < float(minimum)) or (
                maximum is not None and observed > float(maximum)
            )
            if not violated:
                continue

            try:
                code = ErrorCode(str(rule["code"]))
            except ValueError:
                continue  # unknown code in config - ignore rather than crash

            errors.append(
                build_error(
                    code,
                    joint=str(rule.get("joint")) if rule.get("joint") else None,
                    observed=observed,
                    expected_min=float(minimum) if minimum is not None else None,
                    expected_max=float(maximum) if maximum is not None else None,
                )
            )

        return errors

    @staticmethod
    def _rule_applies(rule: Mapping[str, Any], state: MovementState) -> bool:
        when = str(rule.get("when", "always"))
        if when == "always":
            return True
        if when == "at_peak":
            # HOLDING is a HOLD exercise's equivalent of being at the peak:
            # the position the rules were written to judge. Without this, a
            # config inherited from a rep-based version of the same exercise
            # would silently evaluate none of its rules.
            return state in (MovementState.DOWN, MovementState.HOLDING)
        if when == "at_rest":
            return state is MovementState.UP
        if when == "moving":
            return state in (MovementState.GOING_DOWN, MovementState.GOING_UP)
        return True

    # -- scoring ------------------------------------------------------------

    @staticmethod
    def score_frame(errors: Sequence[DetectedError]) -> float:
        """Frame score in [0, 100].

        Starts at 100 and subtracts a per-code penalty from the feedback
        catalogue. Tracking-quality codes carry a penalty of 0, so a patient is
        never marked down for poor lighting.

        Deliberately simple, bounded, documented and testable - the opposite of
        an opaque "AI accuracy" number.
        """
        score = 100.0
        for error in errors:
            score -= penalty_for(error.code)
        return clamp(score, 0.0, 100.0)

    # -- main entry point ---------------------------------------------------

    def analyze(
        self,
        frame: Optional[PoseFrame],
        *,
        people_detected: int,
        now: Optional[float] = None,
    ) -> FrameAnalysis:
        """Analyse one frame and advance the session state."""
        errors: list[DetectedError] = []

        if people_detected == 0 or frame is None:
            errors.append(build_error(ErrorCode.NO_PERSON_DETECTED))
            hold_snapshot: Optional[HoldSnapshot] = None
            if self.hold is not None:
                # Nobody in frame is not a held position. The clock stops and
                # the current streak breaks; the seconds already earned stay.
                hold_snapshot = self.hold.update(
                    aligned=False, tracking_valid=False, now=now
                )
            else:
                self.machine.update(None, tracking_valid=False, now=now)
            return FrameAnalysis(
                tracking_valid=False,
                confidence=0.0,
                angles={},
                missing_landmarks=[lm.value for lm in self.config.required_landmarks],
                movement_state=(
                    MovementState.IDLE
                    if self.hold is not None
                    else self.machine.state
                ),
                state_held_ms=self.machine.state_held_ms(now),
                posture_correct=False,
                posture_score=0.0,
                errors=errors,
                rep_count=self.rep_count,
                hold=hold_snapshot,
            )

        if people_detected > 1:
            errors.append(build_error(ErrorCode.MULTIPLE_PEOPLE))

        visible, missing, confidence = self.check_visibility(frame)
        if not visible:
            errors.append(
                build_error(
                    ErrorCode.PARTIAL_BODY_VISIBLE,
                    message_override=(
                        "Move back so your full body is visible "
                        f"(cannot see: {', '.join(m.replace('_', ' ') for m in missing)})."
                    ),
                )
            )
        elif confidence < self.config.min_visibility + 0.15:
            errors.append(build_error(ErrorCode.LOW_CONFIDENCE, observed=confidence))

        raw_angles = self.compute_angles(frame)
        smoothed: dict[str, Optional[float]] = {
            name: self.smoother.push(name, value)
            for name, value in raw_angles.items()
        }

        tracking_valid = visible
        rep_event: Optional[RepEvent] = None
        hold_snapshot: Optional[HoldSnapshot] = None

        if self.hold is not None:
            # --- HOLD: no cycle to advance, so the rules are evaluated
            # against the held position directly and the verdict drives the
            # clock. Order matters - alignment has to be decided before the
            # tracker can be told whether to credit this frame.
            if tracking_valid:
                errors.extend(
                    self.evaluate_posture(smoothed, MovementState.HOLDING)
                )
            aligned = tracking_valid and not any(
                e.code not in TRACKING_CODES for e in errors
            )
            hold_snapshot = self.hold.update(
                aligned=aligned, tracking_valid=tracking_valid, now=now
            )
            movement_state = (
                MovementState.HOLDING if hold_snapshot.active else MovementState.IDLE
            )
        else:
            primary = smoothed.get(self.config.movement.primary_angle)
            rep_event = self.machine.update(
                primary, tracking_valid=tracking_valid, now=now
            )
            if tracking_valid:
                errors.extend(self.evaluate_posture(smoothed, self.machine.state))
            movement_state = self.machine.state

        score = self.score_frame(errors)
        reported = {
            name: round(value, 1)
            for name, value in smoothed.items()
            if value is not None
        }

        if tracking_valid:
            self.accumulator.observe(score, confidence, errors, reported)

        return FrameAnalysis(
            tracking_valid=tracking_valid,
            confidence=round(confidence, 3),
            angles=reported,
            missing_landmarks=missing,
            movement_state=movement_state,
            state_held_ms=round(self.machine.state_held_ms(now), 1),
            posture_correct=not any(
                e.code not in TRACKING_CODES for e in errors
            ),
            posture_score=round(score, 1),
            errors=errors,
            rep_event=rep_event,
            rep_count=self.rep_count,
            hold=hold_snapshot,
        )

    def flush_rep(self) -> tuple[float, float, dict, dict[str, int]]:
        """Collect and clear the accumulated statistics for a finished rep."""
        score = self.accumulator.mean_score()
        confidence = self.accumulator.mean_confidence()
        angle_summary = self.accumulator.angles.summary()
        error_counts = {
            code.value: count
            for code, count in self.accumulator.error_counts.items()
            if code not in TRACKING_CODES
        }
        self.accumulator.reset()
        return score, confidence, angle_summary, error_counts

    def hold_summary(self) -> dict[str, Any]:
        """Cumulative session statistics for a HOLD exercise. NON-destructive.

        A repetition exercise flushes its accumulator every rep, so each
        RepResult row carries its own slice and the backend rebuilds the
        session by aggregating them. A hold exercise has no such slices, so the
        same accumulator runs for the whole session and is READ rather than
        drained - which also means every snapshot posted to the backend is a
        complete restatement, and a lost one costs nothing.
        """
        if self.hold is None:
            raise RuntimeError("hold_summary() is only valid for HOLD exercises")

        snapshot = self.hold.snapshot()
        return {
            "heldSeconds": round(snapshot.held_seconds, 2),
            "targetSeconds": round(snapshot.target_seconds, 2),
            "bestStreakSeconds": round(snapshot.best_streak_seconds, 2),
            "analysedFrames": self.accumulator.frames,
            "meanScore": round(self.accumulator.mean_score(), 2),
            "meanConfidence": round(self.accumulator.mean_confidence(), 3),
            "angleStats": self.accumulator.angles.summary(),
            "errors": [
                {"code": code.value, "occurrences": count}
                for code, count in self.accumulator.error_counts.items()
                if code not in TRACKING_CODES
            ],
        }

    def is_rep_correct(self, score: float, error_codes: Mapping[str, int]) -> bool:
        """A rep is correct when it scores well AND has no critical fault.

        The threshold lives in ExerciseRuleConfig - never hard-coded, which is
        how the superseded prototype ended up with a literal `accuracy: 80`
        in the React session page.
        """
        for raw_code in error_codes:
            try:
                entry = CATALOGUE[ErrorCode(raw_code)]
            except (KeyError, ValueError):
                continue
            if entry.severity is Severity.CRITICAL:
                return False
        return score >= self.config.rep_correctness_threshold

    def reset_cycle(self) -> None:
        self.machine.reset_cycle()
        self.smoother.reset()
        if self.hold is not None:
            # Break the streak but keep the accumulated seconds AND the running
            # session statistics: for a hold exercise the accumulator is the
            # whole report, so clearing it here would erase the session on a
            # reconnect. A rep exercise has already persisted its finished
            # repetitions, so it loses only the partial one.
            self.hold.reset_cycle()
        else:
            self.accumulator.reset()
