"""Posture analysis module."""

from typing import Dict, Optional

import numpy as np

from analysis.angle_calculation import calculate_angle, get_joint
from analysis.base import BaseExerciseAnalyzer


class PostureAnalyzer(BaseExerciseAnalyzer):
    exercise_name = "Posture"
    required_joints = [
        "left_shoulder",
        "right_shoulder",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
    ]

    SHOULDER_THRESHOLD = 20.0
    HIP_THRESHOLD = 20.0
    SPINE_THRESHOLD = 15.0

    def __init__(self):
        super().__init__()
        self.state = "unknown"

    def _spine_angle(self, keypoints: Dict) -> Optional[float]:
        left_shoulder = get_joint(keypoints, "left_shoulder")
        right_shoulder = get_joint(keypoints, "right_shoulder")
        left_hip = get_joint(keypoints, "left_hip")
        right_hip = get_joint(keypoints, "right_hip")

        if not all([left_shoulder, right_shoulder, left_hip, right_hip]):
            return None

        shoulder_mid = {
            "x": (left_shoulder["x"] + right_shoulder["x"]) / 2,
            "y": (left_shoulder["y"] + right_shoulder["y"]) / 2,
        }
        hip_mid = {
            "x": (left_hip["x"] + right_hip["x"]) / 2,
            "y": (left_hip["y"] + right_hip["y"]) / 2,
        }
        knee = get_joint(keypoints, "left_knee") or get_joint(keypoints, "right_knee")
        if knee is None:
            vertical_ref = {"x": hip_mid["x"], "y": hip_mid["y"] - 100}
            return calculate_angle(vertical_ref, hip_mid, shoulder_mid)

        return calculate_angle(shoulder_mid, hip_mid, knee)

    def analyze(self, keypoints: Dict) -> Dict:
        self.feedback = []
        missing = self._missing_joints(keypoints)
        if missing:
            self.feedback.append(f"Missing keypoints: {', '.join(missing)}")
            self.state = "unknown"
            return self._build_result({})

        left_shoulder = get_joint(keypoints, "left_shoulder")
        right_shoulder = get_joint(keypoints, "right_shoulder")
        left_hip = get_joint(keypoints, "left_hip")
        right_hip = get_joint(keypoints, "right_hip")

        shoulder_diff = abs(left_shoulder["y"] - right_shoulder["y"])
        hip_diff = abs(left_hip["y"] - right_hip["y"])
        spine_angle = self._spine_angle(keypoints)

        angles = {
            "shoulder_alignment": round(shoulder_diff, 1),
            "hip_alignment": round(hip_diff, 1),
        }
        if spine_angle is not None:
            angles["spine"] = round(spine_angle, 1)

        is_correct = True
        frame_score = 100.0

        if shoulder_diff > self.SHOULDER_THRESHOLD:
            self.feedback.append("Balance your shoulders")
            is_correct = False
            frame_score -= 25

        if hip_diff > self.HIP_THRESHOLD:
            self.feedback.append("Balance your hips")
            is_correct = False
            frame_score -= 20

        if spine_angle is not None:
            deviation = abs(180 - spine_angle)
            if deviation > self.SPINE_THRESHOLD:
                self.feedback.append("Straighten your back")
                is_correct = False
                frame_score -= 30

        self.state = "correct" if is_correct else "incorrect"
        if is_correct:
            self.feedback.append("Correct posture")

        self._record_accuracy(frame_score)
        return self._build_result(angles)
