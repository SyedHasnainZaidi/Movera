"""YOLOv8 keypoint conversion and the rules that depend on pixel space.

These cover the seam created by swapping MediaPipe for YOLOv8: turning an
ultralytics keypoint array into named points, and the two things that behave
differently in pixel space than they did in metric world space - distance
thresholds and the knee-alignment ratio.

The model itself is not loaded here. `_to_pose_frame` is pure and takes the
array ultralytics would have produced, so these run in milliseconds and need no
weights on disk.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.exercises.base import RuleConfig
from app.exercises.registry import build_analyzer
from app.geometry.angles import PIXEL_REFERENCE_WIDTH, to_reference_scale
from app.landmarks.registry import (
    LANDMARK_INDEX,
    Keypoint,
    Landmark,
    PoseFrame,
)
from app.pose.detector import _to_pose_frame, select_primary_pose

FRAME_W, FRAME_H = 640, 480


def full_person(confidence: float = 0.9) -> tuple[np.ndarray, np.ndarray]:
    """A plausible 17-point COCO detection."""
    xy = np.zeros((17, 2), dtype=np.float32)
    for index in range(17):
        # Spread the points out so none land on the origin, which the
        # converter treats as "not placed".
        xy[index] = (100.0 + index * 5.0, 80.0 + index * 12.0)
    conf = np.full(17, confidence, dtype=np.float32)
    return xy, conf


class TestKeypointConversion:
    def test_all_seventeen_keypoints_are_named(self) -> None:
        xy, conf = full_person()
        frame = _to_pose_frame(xy, conf, FRAME_W, FRAME_H, 0.5)
        assert frame is not None
        assert len(frame.pixels) == 17
        assert set(frame.pixels) == set(LANDMARK_INDEX)

    def test_index_mapping_matches_the_coco_order(self) -> None:
        """Index 5 is the left shoulder, 16 the right ankle - COCO's order.

        Getting this wrong swaps joints silently and every angle becomes
        nonsense, so it is asserted against explicit positions rather than
        trusted.
        """
        xy, conf = full_person()
        frame = _to_pose_frame(xy, conf, FRAME_W, FRAME_H, 0.5)
        assert frame is not None
        assert frame.pixels[Landmark.LEFT_SHOULDER].x == pytest.approx(xy[5][0])
        assert frame.pixels[Landmark.RIGHT_ANKLE].y == pytest.approx(xy[16][1])
        assert frame.pixels[Landmark.NOSE].x == pytest.approx(xy[0][0])

    def test_pixels_are_raw_and_normalized_is_scaled(self) -> None:
        xy, conf = full_person()
        frame = _to_pose_frame(xy, conf, FRAME_W, FRAME_H, 0.5)
        assert frame is not None
        pixel = frame.pixels[Landmark.LEFT_HIP]
        norm = frame.normalized[Landmark.LEFT_HIP]
        assert norm.x == pytest.approx(pixel.x / FRAME_W)
        assert norm.y == pytest.approx(pixel.y / FRAME_H)
        assert 0.0 <= norm.x <= 1.0 and 0.0 <= norm.y <= 1.0

    def test_low_confidence_keypoints_are_dropped(self) -> None:
        """Matches the prototype's get_joint(min_confidence=0.5) gate."""
        xy, conf = full_person()
        conf[LANDMARK_INDEX[Landmark.LEFT_KNEE]] = 0.2
        frame = _to_pose_frame(xy, conf, FRAME_W, FRAME_H, 0.5)
        assert frame is not None
        assert Landmark.LEFT_KNEE not in frame.pixels
        assert Landmark.RIGHT_KNEE in frame.pixels

    def test_origin_keypoints_are_dropped(self) -> None:
        """YOLO reports (0,0) for a joint it could not place at all.

        Kept as a real detection, an ankle pinned to the frame's top-left
        corner drags every angle it participates in to a wrong value.
        """
        xy, conf = full_person()
        xy[LANDMARK_INDEX[Landmark.LEFT_ANKLE]] = (0.0, 0.0)
        frame = _to_pose_frame(xy, conf, FRAME_W, FRAME_H, 0.5)
        assert frame is not None
        assert Landmark.LEFT_ANKLE not in frame.pixels

    def test_returns_none_when_nothing_survives(self) -> None:
        xy, conf = full_person(confidence=0.1)
        assert _to_pose_frame(xy, conf, FRAME_W, FRAME_H, 0.5) is None

    def test_frame_size_is_recorded(self) -> None:
        xy, conf = full_person()
        frame = _to_pose_frame(xy, conf, FRAME_W, FRAME_H, 0.5)
        assert frame is not None
        # Distance rules need it to rescale into the reference width.
        assert (frame.width, frame.height) == (FRAME_W, FRAME_H)


class TestPrimaryPoseSelection:
    def make(self, torso_half_width: float) -> PoseFrame:
        points = {
            Landmark.LEFT_SHOULDER: (240 - torso_half_width, 100),
            Landmark.RIGHT_SHOULDER: (240 + torso_half_width, 100),
            Landmark.LEFT_HIP: (240 - torso_half_width, 300),
            Landmark.RIGHT_HIP: (240 + torso_half_width, 300),
        }
        pixels = {
            name: Keypoint(x=x, y=y, confidence=0.9)
            for name, (x, y) in points.items()
        }
        normalized = {
            name: Keypoint(x=p.x / 480, y=p.y / 480, confidence=0.9)
            for name, p in pixels.items()
        }
        return PoseFrame(
            pixels=pixels, normalized=normalized, width=480, height=480
        )

    def test_largest_torso_wins(self) -> None:
        """The prototype took keypoints.xy[0] - whoever YOLO listed first.

        That is detection order, not "the patient", so a bystander could be
        analysed instead. The nearest person is chosen deliberately here.
        """
        far = self.make(20)
        near = self.make(90)
        assert select_primary_pose([far, near]) is near
        assert select_primary_pose([near, far]) is near

    def test_single_pose_passes_through(self) -> None:
        only = self.make(50)
        assert select_primary_pose([only]) is only

    def test_empty_is_none(self) -> None:
        assert select_primary_pose([]) is None


class TestPixelReferenceScaling:
    """Distances must mean the same thing at any frame width.

    The prototype's thresholds (elbow drift > 40 px, shoulder gap > 20 px) were
    written against 640x480 webcam frames. The browser sends 480-wide frames,
    so without rescaling every one of those rules would fire 33% too easily.
    """

    def test_reference_width_is_unchanged(self) -> None:
        assert to_reference_scale(40.0, int(PIXEL_REFERENCE_WIDTH)) == pytest.approx(40.0)

    def test_narrower_frame_scales_up(self) -> None:
        # 30 px in a 480-wide frame is 40 px in a 640-wide one.
        assert to_reference_scale(30.0, 480) == pytest.approx(40.0)

    def test_wider_frame_scales_down(self) -> None:
        assert to_reference_scale(40.0, 1280) == pytest.approx(20.0)

    def test_missing_or_degenerate_returns_none(self) -> None:
        assert to_reference_scale(None, 480) is None
        assert to_reference_scale(40.0, 0) is None


class TestRatioAngleType:
    """The squat's knee-alignment rule: knee_width < ankle_width * 0.7."""

    RULES = {
        "exerciseSlug": "squat",
        "ruleConfigVersion": 1,
        "requiredLandmarks": [
            "left_knee", "right_knee", "left_ankle", "right_ankle",
        ],
        "angleDefinitions": {
            "kneeWidth": {"type": "gap_x", "a": "left_knee", "b": "right_knee"},
            "ankleWidth": {"type": "gap_x", "a": "left_ankle", "b": "right_ankle"},
            "kneeAnkleRatio": {
                "type": "ratio",
                "numerator": "kneeWidth",
                "denominator": "ankleWidth",
            },
        },
        "movementStateConfig": {
            "primaryAngle": "kneeAnkleRatio",
            "direction": "DECREASING",
            "restAngle": 1.0,
            "peakAngle": 0.5,
        },
        "postureRules": [],
        "minVisibility": 0.5,
        "repCorrectnessThreshold": 70,
    }

    def build(self, knee_half: float, ankle_half: float) -> PoseFrame:
        points = {
            Landmark.LEFT_KNEE: (240 - knee_half, 300),
            Landmark.RIGHT_KNEE: (240 + knee_half, 300),
            Landmark.LEFT_ANKLE: (240 - ankle_half, 420),
            Landmark.RIGHT_ANKLE: (240 + ankle_half, 420),
        }
        pixels = {
            name: Keypoint(x=x, y=y, confidence=0.9)
            for name, (x, y) in points.items()
        }
        normalized = {
            name: Keypoint(x=p.x / 480, y=p.y / 480, confidence=0.9)
            for name, p in pixels.items()
        }
        return PoseFrame(
            pixels=pixels, normalized=normalized, width=480, height=480
        )

    def analyzer(self):
        return build_analyzer(RuleConfig.from_payload(self.RULES))

    def test_equal_widths_give_one(self) -> None:
        angles = self.analyzer().compute_angles(self.build(50, 50))
        assert angles["kneeAnkleRatio"] == pytest.approx(1.0)

    def test_knees_collapsing_inward_drops_below_threshold(self) -> None:
        # Knees at half the ankle width -> ratio 0.5, under the 0.7 rule.
        angles = self.analyzer().compute_angles(self.build(25, 50))
        assert angles["kneeAnkleRatio"] == pytest.approx(0.5)
        assert angles["kneeAnkleRatio"] < 0.7

    def test_ratio_is_scale_invariant(self) -> None:
        """The whole point of a ratio: standing further away must not change it."""
        near = self.analyzer().compute_angles(self.build(60, 80))
        far = self.analyzer().compute_angles(self.build(30, 40))
        assert near["kneeAnkleRatio"] == pytest.approx(far["kneeAnkleRatio"])

    def test_zero_denominator_is_unmeasurable_not_infinite(self) -> None:
        """Ankles exactly in line would otherwise divide by zero."""
        angles = self.analyzer().compute_angles(self.build(50, 0))
        assert angles["kneeAnkleRatio"] is None

    def test_missing_landmark_yields_none(self) -> None:
        frame = self.build(50, 50)
        stripped = PoseFrame(
            pixels={
                k: v
                for k, v in frame.pixels.items()
                if k is not Landmark.LEFT_ANKLE
            },
            normalized=frame.normalized,
            width=frame.width,
            height=frame.height,
        )
        angles = self.analyzer().compute_angles(stripped)
        assert angles["ankleWidth"] is None
        assert angles["kneeAnkleRatio"] is None
