"""Joint-angle geometry.

Ported from `analysis/angle_calculation.py` in the project's YOLO/FastAPI
prototype. The core is unchanged and was already correct - it handled the two
failure modes that matter, zero-length vectors and floating-point overshoot
past +/-1 before arccos. What is added here is explicit NaN/inf rejection,
None-returning instead of raising, and the distance helpers the posture rules
need.

Coordinate space
----------------
Everything here works in IMAGE PIXELS, because that is what YOLOv8 pose returns
and the space the prototype's thresholds were tuned in. Angles between three
points are scale-invariant, so a 480-wide frame and a 640-wide frame give the
same joint angle. Straight-line DISTANCES are not scale-invariant, which is
what `to_reference_scale` exists to fix.

+Y points DOWN, as in every image coordinate system.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence

import numpy as np

from app.landmarks.registry import Keypoint

#: Below this vector length the direction is meaningless and the angle is
#: undefined - two keypoints have effectively collapsed onto each other.
_MIN_VECTOR_NORM = 1e-6

#: Frame width the prototype's pixel thresholds were written against.
#:
#: `cv2.VideoCapture(0)` opens a webcam at 640x480 by default, and the
#: prototype fed those frames straight to YOLO, so rules like
#: "elbow_drift > 40" and "shoulder_diff > 20" are distances in a 640-wide
#: image. The browser here sends 480-wide frames, which would make every one of
#: those thresholds fire ~25% too easily. Distances are converted into this
#: reference width before being compared, so the prototype's numbers keep the
#: meaning they were tuned with.
PIXEL_REFERENCE_WIDTH = 640.0


def to_reference_scale(distance: Optional[float], frame_width: int) -> Optional[float]:
    """Convert a pixel distance in the analysed frame to reference-width pixels."""
    if distance is None or frame_width <= 0:
        return None
    scaled = distance * (PIXEL_REFERENCE_WIDTH / float(frame_width))
    return scaled if math.isfinite(scaled) else None


def _as_vector(point: Keypoint) -> Optional[np.ndarray]:
    if not math.isfinite(point.x) or not math.isfinite(point.y):
        return None
    return np.array((point.x, point.y), dtype=np.float64)


def angle_between(
    a: Optional[Keypoint],
    b: Optional[Keypoint],
    c: Optional[Keypoint],
) -> Optional[float]:
    """Interior angle at ``b`` formed by the path a -> b -> c, in degrees.

        BA = A - B
        BC = C - B
        angle = arccos( (BA . BC) / (|BA| * |BC|) )

    Returns ``None`` - never raises and never returns NaN - when any point is
    missing, non-finite, or when either vector has collapsed to near-zero
    length. Callers treat ``None`` as "not measurable this frame", which is a
    meaningful state: it freezes the rep counter rather than feeding it garbage.
    """
    if a is None or b is None or c is None:
        return None

    va, vb, vc = (_as_vector(p) for p in (a, b, c))
    if va is None or vb is None or vc is None:
        return None

    ba = va - vb
    bc = vc - vb

    norm_ba = float(np.linalg.norm(ba))
    norm_bc = float(np.linalg.norm(bc))
    if norm_ba < _MIN_VECTOR_NORM or norm_bc < _MIN_VECTOR_NORM:
        return None

    cosine = float(np.dot(ba, bc)) / (norm_ba * norm_bc)
    # Rounding can push a legitimately parallel pair to 1.0000000002, which
    # makes arccos return NaN. Clipping is mandatory, not defensive padding.
    cosine = max(-1.0, min(1.0, cosine))

    degrees = math.degrees(math.acos(cosine))
    return degrees if math.isfinite(degrees) else None


def angle_from_vertical(
    upper: Optional[Keypoint],
    lower: Optional[Keypoint],
) -> Optional[float]:
    """Tilt of the segment ``lower -> upper`` away from vertical, in degrees.

    0 deg = perfectly upright, 90 deg = horizontal. Used for trunk lean, where
    the meaningful quantity is deviation from gravity rather than an angle
    between three body points.

    In image coordinates +Y points DOWN, so "up the screen" is (0, -1).
    """
    if upper is None or lower is None:
        return None

    vu = _as_vector(upper)
    vl = _as_vector(lower)
    if vu is None or vl is None:
        return None

    segment = vu - vl
    norm = float(np.linalg.norm(segment))
    if norm < _MIN_VECTOR_NORM:
        return None

    vertical = np.array([0.0, -1.0])
    cosine = float(np.dot(segment, vertical)) / norm
    cosine = max(-1.0, min(1.0, cosine))

    degrees = math.degrees(math.acos(cosine))
    return degrees if math.isfinite(degrees) else None


def midpoint(a: Optional[Keypoint], b: Optional[Keypoint]) -> Optional[Keypoint]:
    """Virtual keypoint halfway between two real ones (e.g. pelvis centre).

    Confidence is the MINIMUM of the two, not the mean: a midpoint is only as
    trustworthy as its least reliable parent.
    """
    if a is None or b is None:
        return None
    return Keypoint(
        x=(a.x + b.x) / 2.0,
        y=(a.y + b.y) / 2.0,
        confidence=min(a.confidence, b.confidence),
    )


def average_angle(*values: Optional[float]) -> Optional[float]:
    """Mean of the angles that could actually be measured.

    Returns ``None`` only when none were measurable, so a patient standing at a
    slight angle - with one knee occluded - still yields a usable reading from
    the visible side rather than dropping the frame.
    """
    present = [v for v in values if v is not None and math.isfinite(v)]
    if not present:
        return None
    return sum(present) / len(present)


def horizontal_distance(
    a: Optional[Keypoint],
    b: Optional[Keypoint],
) -> Optional[float]:
    """Absolute separation along X, in frame pixels."""
    if a is None or b is None:
        return None
    value = abs(a.x - b.x)
    return value if math.isfinite(value) else None


def vertical_distance(
    a: Optional[Keypoint],
    b: Optional[Keypoint],
) -> Optional[float]:
    """Absolute separation along Y, in frame pixels."""
    if a is None or b is None:
        return None
    value = abs(a.y - b.y)
    return value if math.isfinite(value) else None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def percentile(values: Sequence[float], q: float) -> Optional[float]:
    """Percentile helper used for latency reporting (q in [0, 100])."""
    if not values:
        return None
    return float(np.percentile(np.asarray(values, dtype=np.float64), q))
