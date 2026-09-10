"""Shoulder abduction exercise analysis."""

from typing import Dict, Optional

from analysis.angle_calculation import average_angle, calculate_angle, get_joint
from analysis.base import BaseExerciseAnalyzer


class ShoulderAbductionAnalyzer(BaseExerciseAnalyzer):
    exercise_name = "Shoulder Abduction"
    required_joints = [
        "left_hip",
        "right_hip",
        "left_shoulder",
        "right_shoulder",
        "left_elbow",
        "right_elbow",
    ]

    def __init__(self):
        super().__init__()
        self.state = "down"

    def _shoulder_angle(self, keypoints: Dict, side: str) -> Optional[float]:
        hip = get_joint(keypoints, f"{side}_hip")
        shoulder = get_joint(keypoints, f"{side}_shoulder")
        elbow = get_joint(keypoints, f"{side}_elbow")
        if hip and shoulder and elbow:
            return calculate_angle(hip, shoulder, elbow)
        return None

    def _detect_state(self, angle: float) -> str:
        if angle < 30:
            return "down"
        if angle > 90:
            return "raised"
        return "transition"

    def analyze(self, keypoints: Dict) -> Dict:
        self.feedback = []
        missing = self._missing_joints(keypoints)
        if missing:
            self.feedback.append(f"Missing keypoints: {', '.join(missing)}")
            return self._build_result({})

        left_angle = self._shoulder_angle(keypoints, "left")
        right_angle = self._shoulder_angle(keypoints, "right")
        shoulder_angle = average_angle(left_angle, right_angle)

        if shoulder_angle is None:
            self.feedback.append("Unable to calculate shoulder angle")
            return self._build_result({})

        angles = {"shoulder": round(shoulder_angle, 1)}
        new_state = self._detect_state(shoulder_angle)
        self._update_rep_counter(new_state)
        self.state = new_state if new_state != "transition" else self.state

        frame_score = 100.0
        if shoulder_angle < 80 and self.state == "raised":
            self.feedback.append("Raise arm properly")
            frame_score -= 25

        left_hip = get_joint(keypoints, "left_hip")
        right_hip = get_joint(keypoints, "right_hip")
        left_shoulder = get_joint(keypoints, "left_shoulder")
        right_shoulder = get_joint(keypoints, "right_shoulder")
        if left_hip and right_hip and left_shoulder and right_shoulder:
            hip_tilt = abs(left_hip["y"] - right_hip["y"])
            shoulder_tilt = abs(left_shoulder["y"] - right_shoulder["y"])
            if hip_tilt > 25 or shoulder_tilt > 20:
                self.feedback.append("Maintain posture")
                frame_score -= 20

        if not self.feedback:
            self.feedback.append("Good form")

        self._record_accuracy(frame_score)
        return self._build_result(angles)

    def _update_rep_counter(self, new_state: str):
        if new_state == "transition":
            return
        if self._prev_state == "down" and new_state == "raised":
            self._rep_phase = "raised"
        elif self._prev_state == "raised" and new_state == "down":
            if getattr(self, "_rep_phase", None) == "raised":
                self.repetitions += 1
            self._rep_phase = "down"
        self._prev_state = new_state if new_state != "transition" else self._prev_state
