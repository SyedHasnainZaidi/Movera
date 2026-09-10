"""Straight leg raise exercise analysis."""

from typing import Dict, Optional

from analysis.angle_calculation import average_angle, calculate_angle, get_joint
from analysis.base import BaseExerciseAnalyzer


class StraightLegRaiseAnalyzer(BaseExerciseAnalyzer):
    exercise_name = "Straight Leg Raise"
    required_joints = [
        "left_shoulder",
        "right_shoulder",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
    ]

    def __init__(self):
        super().__init__()
        self.state = "rest"

    def _hip_angle(self, keypoints: Dict, side: str) -> Optional[float]:
        shoulder = get_joint(keypoints, f"{side}_shoulder")
        hip = get_joint(keypoints, f"{side}_hip")
        knee = get_joint(keypoints, f"{side}_knee")
        if shoulder and hip and knee:
            return calculate_angle(shoulder, hip, knee)
        return None

    def _knee_angle(self, keypoints: Dict, side: str) -> Optional[float]:
        hip = get_joint(keypoints, f"{side}_hip")
        knee = get_joint(keypoints, f"{side}_knee")
        ankle = get_joint(keypoints, f"{side}_ankle")
        if hip and knee and ankle:
            return calculate_angle(hip, knee, ankle)
        return None

    def _detect_state(self, hip_angle: float) -> str:
        if hip_angle < 30:
            return "rest"
        if hip_angle > 45:
            return "raised"
        return "transition"

    def analyze(self, keypoints: Dict) -> Dict:
        self.feedback = []
        missing = self._missing_joints(keypoints)
        if missing:
            self.feedback.append(f"Missing keypoints: {', '.join(missing)}")
            return self._build_result({})

        left_hip = self._hip_angle(keypoints, "left")
        right_hip = self._hip_angle(keypoints, "right")
        left_knee = self._knee_angle(keypoints, "left")
        right_knee = self._knee_angle(keypoints, "right")

        hip_angle = average_angle(left_hip, right_hip)
        knee_angle = average_angle(left_knee, right_knee)

        if hip_angle is None:
            self.feedback.append("Unable to calculate hip angle")
            return self._build_result({})

        angles = {"hip": round(hip_angle, 1)}
        if knee_angle is not None:
            angles["knee"] = round(knee_angle, 1)

        new_state = self._detect_state(hip_angle)
        self._update_rep_counter(new_state)
        self.state = new_state if new_state != "transition" else self.state

        frame_score = 100.0
        if knee_angle is not None and knee_angle < 160:
            self.feedback.append("Keep knee straight")
            frame_score -= 30

        if self.state == "raised" and hip_angle < 50:
            self.feedback.append("Lift slowly")
            frame_score -= 10

        if not self.feedback:
            self.feedback.append("Good form")

        self._record_accuracy(frame_score)
        return self._build_result(angles)

    def _update_rep_counter(self, new_state: str):
        if new_state == "transition":
            return
        if self._prev_state == "rest" and new_state == "raised":
            self._rep_phase = "raised"
        elif self._prev_state == "raised" and new_state == "rest":
            if getattr(self, "_rep_phase", None) == "raised":
                self.repetitions += 1
            self._rep_phase = "rest"
        self._prev_state = new_state if new_state != "transition" else self._prev_state
