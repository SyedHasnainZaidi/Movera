"""Single-limb exercise aggregation.

Regression suite for a bug found only by running the application with a real
webcam. The bicep curl's primary angle was defined as the AVERAGE of both
elbows. Curling one arm to 50 degrees while the other rested at 170 gave an
average of 110 - which never crosses the 55-degree peak threshold, so the
movement state machine never reached DOWN and no repetition could complete.

The live session showed it precisely: 1083 frames analysed, tracking valid,
session ACTIVE, and zero repetitions ingested.

Averaging is correct for a squat, where both knees flex together. It is wrong
for any exercise performed one limb at a time.
"""

from __future__ import annotations

import math

import pytest

from app.exercises.base import RuleConfig
from app.exercises.registry import build_analyzer
from app.landmarks.registry import Keypoint, Landmark, PoseFrame

FRAME_W = 480
FRAME_H = 480

UPPER_ARM = 120.0
FOREARM = 110.0
HALF_SHOULDER = 70.0
HALF_HIP = 50.0
SHOULDER_Y = 120.0
HIP_Y = 400.0


def build_arm_pose(
    left_elbow_deg: float,
    right_elbow_deg: float,
    *,
    visibility: float = 0.95,
    drop: tuple[Landmark, ...] = (),
) -> PoseFrame:
    """Skeleton with each elbow at an exactly specified interior angle.

    Image-pixel coordinates, +Y down, as YOLOv8 returns them. The shoulder sits
    directly above the elbow and the forearm swings in the image plane:

        elbow -> shoulder = (0, -1)                      straight up
        elbow -> wrist    = (sin(theta), -cos(theta))    theta from that ray

    so theta=180 hangs the wrist straight down (arm extended) and small theta
    brings it up towards the shoulder (arm curled).

    Both wrists swing towards +x, which keeps each elbow directly below its own
    shoulder - so the elbow-drift rule reads zero and cannot fire spuriously.
    """

    def side(sign: float, angle_deg: float) -> dict[str, tuple[float, float]]:
        theta = math.radians(angle_deg)
        x = 240.0 + sign * HALF_SHOULDER
        shoulder = (x, SHOULDER_Y)
        elbow = (x, SHOULDER_Y + UPPER_ARM)
        wrist = (
            elbow[0] + FOREARM * math.sin(theta),
            elbow[1] - FOREARM * math.cos(theta),
        )
        return {"shoulder": shoulder, "elbow": elbow, "wrist": wrist}

    left = side(-1.0, left_elbow_deg)
    right = side(1.0, right_elbow_deg)

    layout: dict[Landmark, tuple[float, float]] = {
        Landmark.LEFT_SHOULDER: left["shoulder"],
        Landmark.LEFT_ELBOW: left["elbow"],
        Landmark.LEFT_WRIST: left["wrist"],
        Landmark.RIGHT_SHOULDER: right["shoulder"],
        Landmark.RIGHT_ELBOW: right["elbow"],
        Landmark.RIGHT_WRIST: right["wrist"],
        Landmark.LEFT_HIP: (240.0 - HALF_HIP, HIP_Y),
        Landmark.RIGHT_HIP: (240.0 + HALF_HIP, HIP_Y),
    }

    pixels: dict[Landmark, Keypoint] = {}
    normalized: dict[Landmark, Keypoint] = {}
    for name, (x, y) in layout.items():
        if name in drop:
            continue
        pixels[name] = Keypoint(x=x, y=y, confidence=visibility)
        normalized[name] = Keypoint(
            x=x / FRAME_W, y=y / FRAME_H, confidence=visibility
        )

    return PoseFrame(
        pixels=pixels, normalized=normalized, width=FRAME_W, height=FRAME_H
    )


BASE_ANGLES = {
    "leftElbow": {
        "type": "joint",
        "a": "left_shoulder",
        "b": "left_elbow",
        "c": "left_wrist",
    },
    "rightElbow": {
        "type": "joint",
        "a": "right_shoulder",
        "b": "right_elbow",
        "c": "right_wrist",
    },
}

CURL_RULES = {
    "exerciseSlug": "bicep-curl",
    "ruleConfigVersion": 1,
    "requiredLandmarks": [
        "left_shoulder",
        "right_shoulder",
        "left_elbow",
        "right_elbow",
        "left_wrist",
        "right_wrist",
        "left_hip",
        "right_hip",
    ],
    "angleDefinitions": {
        **BASE_ANGLES,
        "elbow": {"type": "min", "of": ["leftElbow", "rightElbow"]},
    },
    "movementStateConfig": {
        "primaryAngle": "elbow",
        "direction": "DECREASING",
        "restAngle": 150,
        "peakAngle": 55,
        "hysteresisDeg": 10,
        "minStateFrames": 2,
        "cooldownMs": 300,
        "minRepDurationMs": 400,
    },
    "postureRules": [],
    "minVisibility": 0.5,
    "repCorrectnessThreshold": 70,
    "smoothingWindow": 3,
}

#: One complete curl of the LEFT arm; the right stays extended throughout.
ONE_ARM_CURL = [170] * 3 + [150, 120, 90] + [48] * 3 + [90, 120, 150] + [170] * 3


def run_curl(rules: dict, both_arms: bool = False) -> list[int]:
    analyzer = build_analyzer(RuleConfig.from_payload(rules))
    completed: list[int] = []
    t = 0.0
    for angle in ONE_ARM_CURL:
        right = float(angle) if both_arms else 170.0
        result = analyzer.analyze(
            build_arm_pose(float(angle), right), people_detected=1, now=t
        )
        if result.rep_event:
            completed.append(result.rep_event.rep_number)
        t += 0.12
    return completed


class TestBicepCurlAggregation:
    def test_min_counts_a_one_armed_curl(self) -> None:
        assert run_curl(CURL_RULES) == [1]

    def test_average_would_have_missed_it(self) -> None:
        """Pins the original defect so it cannot quietly come back."""
        averaged = dict(
            CURL_RULES,
            angleDefinitions={
                **BASE_ANGLES,
                "elbow": {"type": "average", "of": ["leftElbow", "rightElbow"]},
            },
        )
        assert run_curl(averaged) == []

    def test_min_reports_the_working_arm_not_the_average(self) -> None:
        analyzer = build_analyzer(RuleConfig.from_payload(CURL_RULES))
        result = analyzer.analyze(build_arm_pose(50.0, 170.0), people_detected=1)
        # 50, not the 110 that averaging produced.
        assert result.angles["elbow"] == pytest.approx(50.0, abs=2.0)

    def test_min_still_works_when_both_arms_curl_together(self) -> None:
        assert run_curl(CURL_RULES, both_arms=True) == [1]

    def test_counts_three_consecutive_one_armed_reps(self) -> None:
        analyzer = build_analyzer(RuleConfig.from_payload(CURL_RULES))
        completed: list[int] = []
        t = 0.0
        for _ in range(3):
            for angle in ONE_ARM_CURL:
                result = analyzer.analyze(
                    build_arm_pose(float(angle), 170.0), people_detected=1, now=t
                )
                if result.rep_event:
                    completed.append(result.rep_event.rep_number)
                t += 0.12
        assert completed == [1, 2, 3]

    def test_falls_back_to_the_measurable_side(self) -> None:
        """One occluded wrist must not blank the primary angle entirely."""
        analyzer = build_analyzer(RuleConfig.from_payload(CURL_RULES))
        partial = build_arm_pose(50.0, 170.0, drop=(Landmark.RIGHT_WRIST,))

        angles = analyzer.compute_angles(partial)
        assert angles["rightElbow"] is None
        assert angles["elbow"] == pytest.approx(50.0, abs=2.0)

    def test_primary_angle_is_none_when_neither_side_measurable(self) -> None:
        analyzer = build_analyzer(RuleConfig.from_payload(CURL_RULES))
        partial = build_arm_pose(
            50.0, 170.0, drop=(Landmark.LEFT_WRIST, Landmark.RIGHT_WRIST)
        )
        assert analyzer.compute_angles(partial)["elbow"] is None


class TestShoulderRaiseAggregation:
    """MAX is the mirror case, for movements whose angle INCREASES."""

    RAISE_RULES = {
        "exerciseSlug": "shoulder-raise",
        "ruleConfigVersion": 1,
        "requiredLandmarks": [
            "left_shoulder",
            "right_shoulder",
            "left_elbow",
            "right_elbow",
            "left_hip",
            "right_hip",
        ],
        "angleDefinitions": {
            "leftShoulder": {
                "type": "joint",
                "a": "left_hip",
                "b": "left_shoulder",
                "c": "left_elbow",
            },
            "rightShoulder": {
                "type": "joint",
                "a": "right_hip",
                "b": "right_shoulder",
                "c": "right_elbow",
            },
            "shoulder": {"type": "max", "of": ["leftShoulder", "rightShoulder"]},
        },
        "movementStateConfig": {
            "primaryAngle": "shoulder",
            "direction": "INCREASING",
            "restAngle": 30,
            "peakAngle": 80,
            "minStateFrames": 2,
            "cooldownMs": 300,
            "minRepDurationMs": 400,
        },
        "postureRules": [],
        "minVisibility": 0.5,
        "repCorrectnessThreshold": 70,
        "smoothingWindow": 3,
    }

    def test_max_selects_the_raised_arm(self) -> None:
        analyzer = build_analyzer(RuleConfig.from_payload(self.RAISE_RULES))
        # Synthetic angles injected straight into the combining pass, so the
        # selection rule is tested independently of skeleton construction.
        combined = analyzer.compute_angles(build_arm_pose(95.0, 12.0))
        assert combined["shoulder"] == max(
            combined["leftShoulder"], combined["rightShoulder"]
        )

    def test_direction_is_increasing(self) -> None:
        config = RuleConfig.from_payload(self.RAISE_RULES)
        assert config.movement.direction.value == "INCREASING"
        assert config.angle_definitions["shoulder"]["type"] == "max"


class TestCombiningTypes:
    def test_unknown_combining_type_falls_back_to_average(self) -> None:
        """A typo in a config must degrade, not crash a live session."""
        rules = dict(
            CURL_RULES,
            angleDefinitions={
                **BASE_ANGLES,
                "elbow": {"type": "average", "of": ["leftElbow", "rightElbow"]},
            },
        )
        analyzer = build_analyzer(RuleConfig.from_payload(rules))
        angles = analyzer.compute_angles(build_arm_pose(50.0, 170.0))
        assert angles["elbow"] == pytest.approx(110.0, abs=3.0)

    def test_average_remains_correct_for_paired_movements(self) -> None:
        """The squat relies on averaging; this must not have regressed."""
        rules = dict(
            CURL_RULES,
            angleDefinitions={
                **BASE_ANGLES,
                "elbow": {"type": "average", "of": ["leftElbow", "rightElbow"]},
            },
        )
        analyzer = build_analyzer(RuleConfig.from_payload(rules))
        angles = analyzer.compute_angles(build_arm_pose(90.0, 90.0))
        assert angles["elbow"] == pytest.approx(90.0, abs=2.0)
