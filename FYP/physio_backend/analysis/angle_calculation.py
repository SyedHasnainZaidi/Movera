"""Joint angle calculation utilities."""

from typing import Dict, Optional

import numpy as np


def _to_array(point: Dict) -> np.ndarray:
    return np.array([point["x"], point["y"]], dtype=np.float64)


def calculate_angle(point_a: Dict, point_b: Dict, point_c: Dict) -> Optional[float]:
    """
    Calculate angle at point_b formed by point_a -> point_b -> point_c.

    Vector BA = A - B
    Vector BC = C - B
    angle = arccos((BA · BC) / (|BA| * |BC|))

    Returns angle in degrees, or None if calculation is not possible.
    """
    a = _to_array(point_a)
    b = _to_array(point_b)
    c = _to_array(point_c)

    ba = a - b
    bc = c - b

    norm_ba = np.linalg.norm(ba)
    norm_bc = np.linalg.norm(bc)

    if norm_ba == 0 or norm_bc == 0:
        return None

    cosine_angle = np.dot(ba, bc) / (norm_ba * norm_bc)
    cosine_angle = np.clip(cosine_angle, -1.0, 1.0)
    angle_rad = np.arccos(cosine_angle)
    return float(np.degrees(angle_rad))


def get_joint(keypoints: Dict, name: str, min_confidence: float = 0.5) -> Optional[Dict]:
    """Retrieve a keypoint if present and above confidence threshold."""
    joint = keypoints.get(name)
    if joint is None:
        return None
    if joint.get("confidence", 0.0) < min_confidence:
        return None
    return joint


def average_angle(left: Optional[float], right: Optional[float]) -> Optional[float]:
    """Average two angle readings when available."""
    if left is not None and right is not None:
        return (left + right) / 2.0
    return left if left is not None else right
