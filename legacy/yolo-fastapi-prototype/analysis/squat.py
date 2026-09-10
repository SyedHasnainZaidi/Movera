"""Squat exercise analysis."""

from typing import Dict, Optional

from analysis.angle_calculation import average_angle, calculate_angle, get_joint
from analysis.base import BaseExerciseAnalyzer


class SquatAnalyzer(BaseExerciseAnalyzer):
    exercise_name = "Squat"
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
        self.state = "standing"
        self._rep_phase = None

    def _knee_angle(self, keypoints: Dict, side: str) -> Optional[float]:
        hip = get_joint(keypoints, f"{side}_hip")
        knee = get_joint(keypoints, f"{side}_knee")
        ankle = get_joint(keypoints, f"{side}_ankle")
        if hip and knee and ankle:
            return calculate_angle(hip, knee, ankle)
        return None

    def _hip_angle(self, keypoints: Dict, side: str) -> Optional[float]:
        shoulder = get_joint(keypoints, f"{side}_shoulder")
        hip = get_joint(keypoints, f"{side}_hip")
        knee = get_joint(keypoints, f"{side}_knee")
        if shoulder and hip and knee:
            return calculate_angle(shoulder, hip, knee)
        return None

    def _detect_state(self, knee_angle: float) -> str:
        if knee_angle > 160:
            return "standing"
        if 70 <= knee_angle <= 120:
            return "down"
        return "transition"

    def analyze(self, keypoints: Dict) -> Dict:
        self.feedback = []
        missing = self._missing_joints(keypoints)
        if missing:
            self.feedback.append(f"Missing keypoints: {', '.join(missing)}")
            return self._build_result({})

        left_knee = self._knee_angle(keypoints, "left")
        right_knee = self._knee_angle(keypoints, "right")
        left_hip = self._hip_angle(keypoints, "left")
        right_hip = self._hip_angle(keypoints, "right")

        knee_angle = average_angle(left_knee, right_knee)
        hip_angle = average_angle(left_hip, right_hip)

        if knee_angle is None:
            self.feedback.append("Unable to calculate knee angle")
            return self._build_result({})

        angles = {"knee": round(knee_angle, 1)}
        if hip_angle is not None:
            angles["hip"] = round(hip_angle, 1)

        new_state = self._detect_state(knee_angle)
        self._update_rep_counter(new_state)
        self.state = new_state if new_state != "transition" else self.state

        frame_score = 100.0
        if not (70 <= knee_angle <= 120) and self.state == "down":
            self.feedback.append("Adjust squat depth")
            frame_score -= 25

        if hip_angle is not None and hip_angle < 150:
            self.feedback.append("Keep your back straight")
            frame_score -= 20

        left_knee_x = get_joint(keypoints, "left_knee")
        right_knee_x = get_joint(keypoints, "right_knee")
        left_ankle = get_joint(keypoints, "left_ankle")
        right_ankle = get_joint(keypoints, "right_ankle")
        if left_knee_x and right_knee_x and left_ankle and right_ankle:
            knee_width = abs(left_knee_x["x"] - right_knee_x["x"])
            ankle_width = abs(left_ankle["x"] - right_ankle["x"])
            if ankle_width > 0 and knee_width < ankle_width * 0.7:
                self.feedback.append("Keep knees aligned")
                frame_score -= 15

        if not self.feedback:
            self.feedback.append("Good posture")

        self._record_accuracy(frame_score)
        return self._build_result(angles)

    def _update_rep_counter(self, new_state: str):
        if new_state == "transition":
            return
        if self._prev_state == "standing" and new_state == "down":
            self._rep_phase = "down"
        elif self._prev_state == "down" and new_state == "standing":
            if getattr(self, "_rep_phase", None) == "down":
                self.repetitions += 1
            self._rep_phase = "up"
        self._prev_state = new_state if new_state != "transition" else self._prev_state
