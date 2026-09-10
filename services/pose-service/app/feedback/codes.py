"""Error codes, severities and the human-readable message catalogue.

Two rules this module exists to enforce:

1. **No feedback string is written anywhere else.** The superseded prototype
   did `self.feedback.append("Keep knees aligned")` inside each analyzer, which
   meant identical problems produced slightly different wording and could never
   be aggregated. Here a rule emits a CODE; wording lives in exactly one table.

2. **Codes are shared vocabulary.** The same strings are validated by the NestJS
   rep-ingest endpoint and stored in `session_errors.code`, so "your most common
   problem was TRUNK_LEAN" is a GROUP BY rather than text matching.

Tone note: messages are supportive and instructional, never alarming. This is a
rehabilitation aid, and a patient recovering from injury should not be told
their posture is "dangerous".
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Severity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class ErrorCode(str, Enum):
    """Every code the pose service can emit.

    Tracking codes describe whether analysis is possible at all.
    Form codes describe how the movement was performed.
    """

    # --- tracking / framing -------------------------------------------------
    NO_PERSON_DETECTED = "NO_PERSON_DETECTED"
    PARTIAL_BODY_VISIBLE = "PARTIAL_BODY_VISIBLE"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    MULTIPLE_PEOPLE = "MULTIPLE_PEOPLE"
    FRAME_DECODE_ERROR = "FRAME_DECODE_ERROR"

    # --- squat --------------------------------------------------------------
    INSUFFICIENT_DEPTH = "INSUFFICIENT_DEPTH"
    EXCESSIVE_DEPTH = "EXCESSIVE_DEPTH"
    TRUNK_LEAN = "TRUNK_LEAN"
    ASYMMETRIC_LOAD = "ASYMMETRIC_LOAD"
    KNEE_ALIGNMENT = "KNEE_ALIGNMENT"

    # --- bicep curl ---------------------------------------------------------
    ELBOW_DRIFT = "ELBOW_DRIFT"
    INCOMPLETE_ROM = "INCOMPLETE_ROM"

    # --- shoulder raise -----------------------------------------------------
    SHOULDER_HITCH = "SHOULDER_HITCH"
    TRUNK_COMPENSATION = "TRUNK_COMPENSATION"

    # --- straight leg raise -------------------------------------------------
    KNEE_FLEXED = "KNEE_FLEXED"

    # --- static posture -----------------------------------------------------
    SHOULDER_ALIGNMENT = "SHOULDER_ALIGNMENT"
    HIP_ALIGNMENT = "HIP_ALIGNMENT"
    SPINE_ALIGNMENT = "SPINE_ALIGNMENT"

    # --- general ------------------------------------------------------------
    MOVEMENT_TOO_FAST = "MOVEMENT_TOO_FAST"


#: Codes that describe tracking quality rather than the patient's technique.
#: These never count against a repetition score - a patient is not doing the
#: exercise badly because the camera cannot see them.
TRACKING_CODES: frozenset[ErrorCode] = frozenset(
    {
        ErrorCode.NO_PERSON_DETECTED,
        ErrorCode.PARTIAL_BODY_VISIBLE,
        ErrorCode.LOW_CONFIDENCE,
        ErrorCode.MULTIPLE_PEOPLE,
        ErrorCode.FRAME_DECODE_ERROR,
    }
)


@dataclass(frozen=True, slots=True)
class FeedbackEntry:
    severity: Severity
    message: str
    #: Score penalty applied per frame the rule fires, before averaging.
    penalty: float


#: The single source of truth for wording and severity.
CATALOGUE: dict[ErrorCode, FeedbackEntry] = {
    ErrorCode.NO_PERSON_DETECTED: FeedbackEntry(
        Severity.CRITICAL,
        "Step into view so the camera can see your whole body.",
        0.0,
    ),
    ErrorCode.PARTIAL_BODY_VISIBLE: FeedbackEntry(
        Severity.CRITICAL,
        "Move back so your full body is visible.",
        0.0,
    ),
    ErrorCode.LOW_CONFIDENCE: FeedbackEntry(
        Severity.WARNING,
        "Tracking is unsteady. Try brighter, more even lighting.",
        0.0,
    ),
    ErrorCode.MULTIPLE_PEOPLE: FeedbackEntry(
        Severity.WARNING,
        "More than one person is visible. Only the patient should be in frame.",
        0.0,
    ),
    ErrorCode.FRAME_DECODE_ERROR: FeedbackEntry(
        Severity.WARNING,
        "A video frame was skipped. Analysis is continuing.",
        0.0,
    ),
    ErrorCode.INSUFFICIENT_DEPTH: FeedbackEntry(
        Severity.WARNING,
        "Bend your knees a little further on the way down.",
        25.0,
    ),
    ErrorCode.EXCESSIVE_DEPTH: FeedbackEntry(
        Severity.WARNING,
        "That is deeper than needed. Ease up slightly.",
        15.0,
    ),
    ErrorCode.TRUNK_LEAN: FeedbackEntry(
        Severity.WARNING,
        "Keep your upper body more upright.",
        20.0,
    ),
    ErrorCode.ASYMMETRIC_LOAD: FeedbackEntry(
        Severity.INFO,
        "Try to share your weight evenly between both legs.",
        10.0,
    ),
    ErrorCode.KNEE_ALIGNMENT: FeedbackEntry(
        Severity.WARNING,
        "Guide your knees out in line with your toes.",
        20.0,
    ),
    ErrorCode.ELBOW_DRIFT: FeedbackEntry(
        Severity.WARNING,
        "Keep your upper arm still against your side.",
        20.0,
    ),
    ErrorCode.INCOMPLETE_ROM: FeedbackEntry(
        Severity.WARNING,
        "Move through the full range of the exercise.",
        25.0,
    ),
    ErrorCode.SHOULDER_HITCH: FeedbackEntry(
        Severity.WARNING,
        "Relax your shoulder - try not to shrug as you lift.",
        20.0,
    ),
    ErrorCode.TRUNK_COMPENSATION: FeedbackEntry(
        Severity.WARNING,
        "Keep your body still and let the arm do the work.",
        20.0,
    ),
    ErrorCode.MOVEMENT_TOO_FAST: FeedbackEntry(
        Severity.INFO,
        "Slow down and control the movement.",
        10.0,
    ),
    # Wording and penalties below are taken from the prototype's own feedback
    # strings and `frame_score -= N` deductions, so the numbers a patient sees
    # match what the original analyzers produced.
    ErrorCode.KNEE_FLEXED: FeedbackEntry(
        # analysis/straight_leg_raise.py: "Keep knee straight", -30
        Severity.WARNING,
        "Keep your knee straight as you lift.",
        30.0,
    ),
    ErrorCode.SHOULDER_ALIGNMENT: FeedbackEntry(
        # analysis/posture.py: "Balance your shoulders", -25
        Severity.WARNING,
        "Balance your shoulders - one is higher than the other.",
        25.0,
    ),
    ErrorCode.HIP_ALIGNMENT: FeedbackEntry(
        # analysis/posture.py: "Balance your hips", -20
        Severity.WARNING,
        "Balance your hips - your weight is shifted to one side.",
        20.0,
    ),
    ErrorCode.SPINE_ALIGNMENT: FeedbackEntry(
        # analysis/posture.py: "Straighten your back", -30
        Severity.WARNING,
        "Straighten your back.",
        30.0,
    ),
}


@dataclass(frozen=True, slots=True)
class DetectedError:
    """One rule firing on one frame."""

    code: ErrorCode
    severity: Severity
    message: str
    joint: str | None = None
    observed: float | None = None
    expected_min: float | None = None
    expected_max: float | None = None

    def to_dict(self) -> dict[str, object]:
        expected: dict[str, float] = {}
        if self.expected_min is not None:
            expected["min"] = round(self.expected_min, 1)
        if self.expected_max is not None:
            expected["max"] = round(self.expected_max, 1)

        payload: dict[str, object] = {
            "code": self.code.value,
            "severity": self.severity.value.lower(),
            "message": self.message,
        }
        if self.joint:
            payload["joint"] = self.joint
        if self.observed is not None:
            payload["observed"] = round(self.observed, 1)
        if expected:
            payload["expected"] = expected
        return payload


def build_error(
    code: ErrorCode,
    *,
    joint: str | None = None,
    observed: float | None = None,
    expected_min: float | None = None,
    expected_max: float | None = None,
    message_override: str | None = None,
) -> DetectedError:
    """Construct a DetectedError with catalogue wording and severity."""
    entry = CATALOGUE[code]
    return DetectedError(
        code=code,
        severity=entry.severity,
        message=message_override or entry.message,
        joint=joint,
        observed=observed,
        expected_min=expected_min,
        expected_max=expected_max,
    )


def penalty_for(code: ErrorCode) -> float:
    return CATALOGUE[code].penalty
