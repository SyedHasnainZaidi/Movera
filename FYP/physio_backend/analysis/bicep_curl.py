"""Bicep curl exercise analysis."""

from typing import Dict, Optional

from analysis.angle_calculation import average_angle, calculate_angle, get_joint
from analysis.base import BaseExerciseAnalyzer


class BicepCurlAnalyzer(BaseExerciseAnalyzer):
    exercise_name = "Bicep Curl"
    required_joints = [
        "left_shoulder",
        "right_shoulder",
        "left_elbow",
        "right_elbow",
        "left_wrist",
        "right_wrist",
    ]

    def __init__(self):
        super().__init__()
        self.state = "open"
        self._active_side = "right"

    def _elbow_angle(self, keypoints: Dict, side: str) -> Optional[float]:
        shoulder = get_joint(keypoints, f"{side}_shoulder")
        elbow = get_joint(keypoints, f"{side}_elbow")
        wrist = get_joint(keypoints, f"{side}_wrist")
        if shoulder and elbow and wrist:
            return calculate_angle(shoulder, elbow, wrist)
        return None

    def _detect_state(self, angle: float) -> str:
        if angle > 150:
            return "open"
        if angle < 60:
            return "curl"
        return "transition"

    def analyze(self, keypoints: Dict) -> Dict:
        self.feedback = []
        missing = self._missing_joints(keypoints)
        if missing:
            self.feedback.append(f"Missing keypoints: {', '.join(missing)}")
            return self._build_result({})

        left_angle = self._elbow_angle(keypoints, "left")
        right_angle = self._elbow_angle(keypoints, "right")
        elbow_angle = average_angle(left_angle, right_angle)

        if elbow_angle is None:
            self.feedback.append("Unable to calculate elbow angle")
            return self._build_result({})

        angles = {"elbow": round(elbow_angle, 1)}
        new_state = self._detect_state(elbow_angle)
        self._update_rep_counter(new_state)
        self.state = new_state if new_state != "transition" else self.state

        frame_score = 100.0
        if elbow_angle > 120 and self.state == "curl":
            self.feedback.append("Move through full range")
            frame_score -= 30

        shoulder = get_joint(keypoints, f"{self._active_side}_shoulder")
        elbow = get_joint(keypoints, f"{self._active_side}_elbow")
        if shoulder and elbow:
            elbow_drift = abs(elbow["x"] - shoulder["x"])
            if elbow_drift > 40:
                self.feedback.append("Keep elbow fixed")
                frame_score -= 20

        if not self.feedback:
            self.feedback.append("Good form")

        self._record_accuracy(frame_score)
        return self._build_result(angles)

    def _update_rep_counter(self, new_state: str):
        if new_state == "transition":
            return
        if self._prev_state == "open" and new_state == "curl":
            self._rep_phase = "curl"
        elif self._prev_state == "curl" and new_state == "open":
            if getattr(self, "_rep_phase", None) == "curl":
                self.repetitions += 1
            self._rep_phase = "open"
        self._prev_state = new_state if new_state != "transition" else self._prev_state
