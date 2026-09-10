"""End-to-end analyzer tests using synthetic landmarks of known geometry.

These bypass MediaPipe deliberately. By constructing a skeleton whose knee
angle is *exactly* a chosen value, the angle -> state -> posture -> repetition
pipeline can be verified deterministically, with no camera, no model and no
flakiness. MediaPipe's own detection accuracy is Google's concern and is
verified separately in test_mediapipe.py.
"""

from __future__ import annotations

import math

import pytest

from app.exercises.base import RuleConfig
from app.exercises.registry import build_analyzer
from app.feedback.codes import ErrorCode
from app.landmarks.registry import Keypoint, Landmark, PoseFrame
from app.state.movement import MovementState

# ---------------------------------------------------------------------------
# Synthetic skeleton construction
# ---------------------------------------------------------------------------

#: Frame the synthetic pixel coordinates live in. 480 wide matches what the
#: browser actually sends (VITE_POSE_IMAGE_WIDTH).
FRAME_W = 480
FRAME_H = 480

#: Pixels per limb. Chosen so a whole body fits the frame with room to move.
THIGH = 180.0
SHANK = 180.0
TORSO = 200.0
HALF_HIP_WIDTH = 36.0
HALF_SHOULDER_WIDTH = 60.0

#: Where the knee sits in the frame.
ORIGIN_X = 240.0
ORIGIN_Y = 240.0


def build_squat_pose(
    knee_angle_deg: float,
    *,
    trunk_lean_deg: float = 5.0,
    visibility: float = 0.95,
    hidden: tuple[Landmark, ...] = (),
) -> PoseFrame:
    """A skeleton whose knee angle is exactly ``knee_angle_deg``.

    Image-pixel coordinates, +Y pointing DOWN, as YOLOv8 returns them. The knee
    sits at the origin, the hip directly above it, and the ankle is placed on a
    circle so the interior angle at the knee is exact:

        knee -> hip   = (0, -1)                       straight up
        knee -> ankle = (sin(theta), -cos(theta))     theta from that ray

    so theta=180 puts the ankle straight down (a locked-out leg) and theta=90
    puts it horizontal.
    """
    theta = math.radians(knee_angle_deg)
    lean = math.radians(trunk_lean_deg)

    knee = (ORIGIN_X, ORIGIN_Y)
    hip = (ORIGIN_X, ORIGIN_Y - THIGH)
    ankle = (
        ORIGIN_X + SHANK * math.sin(theta),
        ORIGIN_Y - SHANK * math.cos(theta),
    )
    shoulder = (
        hip[0] + TORSO * math.sin(lean),
        hip[1] - TORSO * math.cos(lean),
    )

    layout: dict[Landmark, tuple[float, float]] = {
        Landmark.LEFT_HIP: (hip[0] - HALF_HIP_WIDTH, hip[1]),
        Landmark.RIGHT_HIP: (hip[0] + HALF_HIP_WIDTH, hip[1]),
        Landmark.LEFT_KNEE: (knee[0] - HALF_HIP_WIDTH, knee[1]),
        Landmark.RIGHT_KNEE: (knee[0] + HALF_HIP_WIDTH, knee[1]),
        Landmark.LEFT_ANKLE: (ankle[0] - HALF_HIP_WIDTH, ankle[1]),
        Landmark.RIGHT_ANKLE: (ankle[0] + HALF_HIP_WIDTH, ankle[1]),
        Landmark.LEFT_SHOULDER: (shoulder[0] - HALF_SHOULDER_WIDTH, shoulder[1]),
        Landmark.RIGHT_SHOULDER: (shoulder[0] + HALF_SHOULDER_WIDTH, shoulder[1]),
    }

    pixels: dict[Landmark, Keypoint] = {}
    normalized: dict[Landmark, Keypoint] = {}

    for name, (x, y) in layout.items():
        confidence = 0.0 if name in hidden else visibility
        pixels[name] = Keypoint(x=x, y=y, confidence=confidence)
        normalized[name] = Keypoint(
            x=x / FRAME_W, y=y / FRAME_H, confidence=confidence
        )

    return PoseFrame(
        pixels=pixels, normalized=normalized, width=FRAME_W, height=FRAME_H
    )


SQUAT_RULES = {
    "exerciseSlug": "squat",
    "ruleConfigVersion": 1,
    "requiredLandmarks": [
        "left_hip", "right_hip", "left_knee", "right_knee",
        "left_ankle", "right_ankle", "left_shoulder", "right_shoulder",
    ],
    "angleDefinitions": {
        "leftKnee": {"type": "joint", "a": "left_hip", "b": "left_knee", "c": "left_ankle"},
        "rightKnee": {"type": "joint", "a": "right_hip", "b": "right_knee", "c": "right_ankle"},
        "knee": {"type": "average", "of": ["leftKnee", "rightKnee"]},
        "trunkLean": {"type": "vertical", "upper": "mid_shoulder", "lower": "mid_hip"},
    },
    "movementStateConfig": {
        "primaryAngle": "knee",
        "direction": "DECREASING",
        "restAngle": 160,
        "peakAngle": 100,
        "hysteresisDeg": 8,
        "minStateFrames": 2,
        "cooldownMs": 300,
        "minRepDurationMs": 400,
    },
    "postureRules": [
        {"code": "TRUNK_LEAN", "angle": "trunkLean", "max": 40, "joint": "trunk"},
        {"code": "INSUFFICIENT_DEPTH", "angle": "knee", "when": "at_peak", "max": 110, "joint": "knee"},
    ],
    "minVisibility": 0.5,
    "repCorrectnessThreshold": 70,
    "smoothingWindow": 3,
}


@pytest.fixture
def analyzer():
    return build_analyzer(RuleConfig.from_payload(SQUAT_RULES))


class TestAngleComputation:
    @pytest.mark.parametrize("expected", [180.0, 160.0, 120.0, 90.0, 60.0])
    def test_knee_angle_matches_construction(self, analyzer, expected) -> None:
        """The declarative angle definition must recover the exact geometry."""
        pose = build_squat_pose(expected)
        result = analyzer.analyze(pose, people_detected=1)
        assert result.angles["knee"] == pytest.approx(expected, abs=1.0)

    def test_left_and_right_agree(self, analyzer) -> None:
        result = analyzer.analyze(build_squat_pose(95.0), people_detected=1)
        assert result.angles["leftKnee"] == pytest.approx(
            result.angles["rightKnee"], abs=1.0
        )

    def test_trunk_lean_measured_from_vertical(self, analyzer) -> None:
        result = analyzer.analyze(
            build_squat_pose(170.0, trunk_lean_deg=30.0), people_detected=1
        )
        assert result.angles["trunkLean"] == pytest.approx(30.0, abs=2.0)

    def test_virtual_midpoints_resolve(self, analyzer) -> None:
        """trunkLean depends on mid_shoulder / mid_hip existing."""
        result = analyzer.analyze(build_squat_pose(170.0), people_detected=1)
        assert "trunkLean" in result.angles


class TestVisibilityGating:
    def test_hidden_ankles_block_analysis(self, analyzer) -> None:
        pose = build_squat_pose(
            120.0, hidden=(Landmark.LEFT_ANKLE, Landmark.RIGHT_ANKLE)
        )
        result = analyzer.analyze(pose, people_detected=1)

        assert result.tracking_valid is False
        assert "left_ankle" in result.missing_landmarks
        assert "right_ankle" in result.missing_landmarks
        codes = {e.code for e in result.errors}
        assert ErrorCode.PARTIAL_BODY_VISIBLE in codes

    def test_no_person_reports_and_freezes(self, analyzer) -> None:
        result = analyzer.analyze(None, people_detected=0)
        assert result.tracking_valid is False
        assert result.confidence == 0.0
        assert {e.code for e in result.errors} == {ErrorCode.NO_PERSON_DETECTED}

    def test_multiple_people_warns(self, analyzer) -> None:
        result = analyzer.analyze(build_squat_pose(170.0), people_detected=2)
        codes = {e.code for e in result.errors}
        assert ErrorCode.MULTIPLE_PEOPLE in codes

    def test_reps_never_counted_while_body_hidden(self, analyzer) -> None:
        """The critical safety property: invisible body cannot generate reps."""
        hidden = (Landmark.LEFT_ANKLE, Landmark.RIGHT_ANKLE)
        t = 0.0
        for angle in [170, 170, 140, 120, 95, 92, 92, 120, 140, 170, 170] * 3:
            analyzer.analyze(
                build_squat_pose(float(angle), hidden=hidden),
                people_detected=1,
                now=t,
            )
            t += 0.15
        assert analyzer.machine.rep_count == 0


class TestPostureRules:
    def test_excessive_trunk_lean_flagged(self, analyzer) -> None:
        result = analyzer.analyze(
            build_squat_pose(170.0, trunk_lean_deg=55.0), people_detected=1
        )
        codes = {e.code for e in result.errors}
        assert ErrorCode.TRUNK_LEAN in codes
        assert result.posture_score < 100.0

    def test_upright_trunk_passes(self, analyzer) -> None:
        result = analyzer.analyze(
            build_squat_pose(170.0, trunk_lean_deg=5.0), people_detected=1
        )
        assert ErrorCode.TRUNK_LEAN not in {e.code for e in result.errors}
        assert result.posture_score == 100.0
        assert result.posture_correct is True

    def test_error_carries_observed_and_expected(self, analyzer) -> None:
        result = analyzer.analyze(
            build_squat_pose(170.0, trunk_lean_deg=55.0), people_detected=1
        )
        error = next(e for e in result.errors if e.code is ErrorCode.TRUNK_LEAN)
        assert error.observed is not None
        assert error.expected_max == 40.0
        assert error.joint == "trunk"
        payload = error.to_dict()
        assert payload["severity"] == "warning"
        assert payload["expected"] == {"max": 40.0}

    def test_state_scoped_rule_only_fires_at_peak(self, analyzer) -> None:
        """INSUFFICIENT_DEPTH is scoped to `at_peak` - standing must not fire it."""
        standing = analyzer.analyze(build_squat_pose(170.0), people_detected=1)
        assert ErrorCode.INSUFFICIENT_DEPTH not in {e.code for e in standing.errors}


class TestRepetitionPipeline:
    def test_full_squat_counts_one_rep(self, analyzer) -> None:
        sequence = (
            [170] * 3
            + [150, 135, 120, 105]
            + [95] * 3
            + [105, 120, 135, 150]
            + [170] * 3
        )
        completed = []
        t = 0.0
        for angle in sequence:
            result = analyzer.analyze(
                build_squat_pose(float(angle)), people_detected=1, now=t
            )
            if result.rep_event:
                completed.append(result.rep_event.rep_number)
            t += 0.12

        assert completed == [1]
        assert analyzer.machine.state is MovementState.UP

    def test_rep_summary_has_angle_statistics(self, analyzer) -> None:
        sequence = (
            [170] * 3 + [150, 130, 110] + [95] * 3 + [110, 130, 150] + [170] * 3
        )
        t = 0.0
        for angle in sequence:
            analyzer.analyze(build_squat_pose(float(angle)), people_detected=1, now=t)
            t += 0.12

        score, confidence, angles, errors = analyzer.flush_rep()
        assert 0.0 <= score <= 100.0
        assert 0.0 <= confidence <= 1.0
        assert "knee" in angles
        assert angles["knee"]["min"] < 100.0
        assert angles["knee"]["max"] > 160.0
        assert isinstance(errors, dict)

    def test_clean_rep_is_marked_correct(self, analyzer) -> None:
        sequence = (
            [170] * 3 + [150, 130, 110] + [95] * 3 + [110, 130, 150] + [170] * 3
        )
        t = 0.0
        for angle in sequence:
            analyzer.analyze(
                build_squat_pose(float(angle), trunk_lean_deg=8.0),
                people_detected=1,
                now=t,
            )
            t += 0.12
        score, _, _, errors = analyzer.flush_rep()
        assert analyzer.is_rep_correct(score, errors) is True

    def test_poor_form_rep_is_marked_incorrect(self, analyzer) -> None:
        sequence = (
            [170] * 3 + [150, 130, 110] + [95] * 3 + [110, 130, 150] + [170] * 3
        )
        t = 0.0
        for angle in sequence:
            analyzer.analyze(
                build_squat_pose(float(angle), trunk_lean_deg=70.0),
                people_detected=1,
                now=t,
            )
            t += 0.12
        score, _, _, errors = analyzer.flush_rep()
        assert score < 90.0
        assert ErrorCode.TRUNK_LEAN.value in errors

    def test_threshold_comes_from_config_not_code(self) -> None:
        """Changing the config threshold must change the verdict."""
        strict = dict(SQUAT_RULES, repCorrectnessThreshold=95)
        lenient = dict(SQUAT_RULES, repCorrectnessThreshold=50)

        a_strict = build_analyzer(RuleConfig.from_payload(strict))
        a_lenient = build_analyzer(RuleConfig.from_payload(lenient))

        assert a_strict.is_rep_correct(80.0, {}) is False
        assert a_lenient.is_rep_correct(80.0, {}) is True


class TestResumption:
    def test_analyzer_resumes_from_persisted_count(self) -> None:
        """After a pose-service restart the next rep must be 6, not 1."""
        analyzer = build_analyzer(
            RuleConfig.from_payload(SQUAT_RULES), initial_rep_count=5
        )
        sequence = (
            [170] * 3 + [150, 130, 110] + [95] * 3 + [110, 130, 150] + [170] * 3
        )
        completed = []
        t = 0.0
        for angle in sequence:
            result = analyzer.analyze(
                build_squat_pose(float(angle)), people_detected=1, now=t
            )
            if result.rep_event:
                completed.append(result.rep_event.rep_number)
            t += 0.12
        assert completed == [6]


class TestConfigValidation:
    def test_unknown_landmark_rejected(self) -> None:
        bad = dict(SQUAT_RULES, requiredLandmarks=["left_knee", "third_arm"])
        with pytest.raises(ValueError, match="Unknown landmark"):
            RuleConfig.from_payload(bad)

    def test_unknown_error_code_in_rule_is_ignored(self, analyzer) -> None:
        """A typo in a config must not crash a live session."""
        rules = dict(
            SQUAT_RULES,
            postureRules=[{"code": "NOT_A_REAL_CODE", "angle": "knee", "max": 10}],
        )
        a = build_analyzer(RuleConfig.from_payload(rules))
        result = a.analyze(build_squat_pose(170.0), people_detected=1)
        assert result.posture_score == 100.0
