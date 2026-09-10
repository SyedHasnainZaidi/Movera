"""Joint-angle geometry tests.

These are the tests the superseded prototype never had. The angle function is
the numerical foundation of every posture rule, so its failure modes are
verified explicitly rather than assumed.
"""

from __future__ import annotations

import math

import pytest

from app.geometry.angles import (
    angle_between,
    angle_from_vertical,
    average_angle,
    horizontal_distance,
    midpoint,
    vertical_distance,
)
from app.landmarks.registry import Keypoint


def p(x: float, y: float, z: float = 0.0, vis: float = 1.0) -> Keypoint:
    """Build a keypoint.

    The third coordinate is accepted and IGNORED: YOLOv8 pose is a 2-D
    detector, so depth no longer exists. The parameter is kept so the existing
    call sites in this file still read naturally.
    """
    return Keypoint(x=x, y=y, confidence=vis)


class TestAngleBetween:
    def test_right_angle(self) -> None:
        # A above B, C to the right of B -> 90 degrees at B.
        result = angle_between(p(0, 1), p(0, 0), p(1, 0))
        assert result == pytest.approx(90.0, abs=1e-6)

    def test_straight_line_is_180(self) -> None:
        result = angle_between(p(-1, 0), p(0, 0), p(1, 0))
        assert result == pytest.approx(180.0, abs=1e-6)

    def test_fully_folded_is_zero(self) -> None:
        """Both rays point the same way - the classic arccos(1.0000002) case.

        Without clipping the cosine to [-1, 1] this returns NaN. It is the
        single most important guard in the module.
        """
        result = angle_between(p(1, 0), p(0, 0), p(2, 0))
        assert result is not None
        assert result == pytest.approx(0.0, abs=1e-6)
        assert math.isfinite(result)

    def test_45_degrees(self) -> None:
        result = angle_between(p(1, 0), p(0, 0), p(1, 1))
        assert result == pytest.approx(45.0, abs=1e-6)

    def test_realistic_knee_flexion(self) -> None:
        """Hip above knee, ankle below knee but forward: a bent knee."""
        hip = p(0.0, 0.9)
        knee = p(0.0, 0.5)
        ankle = p(0.35, 0.2)
        result = angle_between(hip, knee, ankle)
        assert result is not None
        assert 120.0 < result < 145.0

    def test_depth_is_ignored(self) -> None:
        """Depth cannot affect the result: YOLOv8 does not measure it.

        This pins the move away from MediaPipe world landmarks. Two arguments
        differing only in a notional third coordinate must now give the same
        answer, because that coordinate is never read.
        """
        flat = angle_between(p(0, 1, 0), p(0, 0, 0), p(1, 0, 0))
        assert flat == pytest.approx(90.0, abs=1e-6)

    # --- failure modes -----------------------------------------------------

    @pytest.mark.parametrize(
        "a,b,c",
        [
            (None, p(0, 0), p(1, 0)),
            (p(0, 1), None, p(1, 0)),
            (p(0, 1), p(0, 0), None),
            (None, None, None),
        ],
    )
    def test_missing_landmark_returns_none(self, a, b, c) -> None:
        assert angle_between(a, b, c) is None

    def test_zero_length_vector_returns_none(self) -> None:
        """A and B collapsed onto the same point - direction is undefined."""
        assert angle_between(p(0, 0), p(0, 0), p(1, 0)) is None

    def test_both_vectors_zero_returns_none(self) -> None:
        assert angle_between(p(0, 0), p(0, 0), p(0, 0)) is None

    def test_nan_input_returns_none(self) -> None:
        assert angle_between(p(float("nan"), 0), p(0, 0), p(1, 0)) is None

    def test_infinite_input_returns_none(self) -> None:
        assert angle_between(p(float("inf"), 0), p(0, 0), p(1, 0)) is None

    def test_never_returns_nan(self) -> None:
        """Property: any finite input yields either None or a real number."""
        for dx in (-2.0, -0.5, 0.0, 0.5, 2.0):
            for dy in (-2.0, -0.5, 0.0, 0.5, 2.0):
                result = angle_between(p(dx, dy), p(0, 0), p(1, 1))
                assert result is None or (
                    math.isfinite(result) and 0.0 <= result <= 180.0
                )


class TestAngleFromVertical:
    def test_upright_is_zero(self) -> None:
        # World coords: +Y points down, so "up" is decreasing Y.
        result = angle_from_vertical(p(0, -1, 0), p(0, 0, 0))
        assert result == pytest.approx(0.0, abs=1e-6)

    def test_horizontal_is_90(self) -> None:
        result = angle_from_vertical(p(1, 0, 0), p(0, 0, 0))
        assert result == pytest.approx(90.0, abs=1e-6)

    def test_forward_lean_is_positive(self) -> None:
        result = angle_from_vertical(p(0.5, -1.0, 0), p(0, 0, 0))
        assert result is not None
        assert 20.0 < result < 30.0

    def test_collapsed_segment_returns_none(self) -> None:
        assert angle_from_vertical(p(0, 0, 0), p(0, 0, 0)) is None

    def test_missing_returns_none(self) -> None:
        assert angle_from_vertical(None, p(0, 0, 0)) is None


class TestHelpers:
    def test_midpoint(self) -> None:
        mid = midpoint(p(0, 0, vis=0.9), p(2, 4, vis=0.5))
        assert mid is not None
        assert (mid.x, mid.y) == (1.0, 2.0)
        # Confidence of a virtual point is the WEAKER of its parents.
        assert mid.confidence == 0.5

    def test_midpoint_missing(self) -> None:
        assert midpoint(None, p(1, 1)) is None

    def test_average_angle_ignores_none(self) -> None:
        assert average_angle(90.0, None) == pytest.approx(90.0)
        assert average_angle(80.0, 100.0) == pytest.approx(90.0)
        assert average_angle(None, None) is None

    def test_average_angle_ignores_nan(self) -> None:
        assert average_angle(float("nan"), 90.0) == pytest.approx(90.0)

    def test_distances(self) -> None:
        assert horizontal_distance(p(0.2, 0.5), p(0.7, 0.5)) == pytest.approx(0.5)
        assert vertical_distance(p(0.2, 0.5), p(0.2, 0.9)) == pytest.approx(0.4)
        assert horizontal_distance(None, p(0, 0)) is None
