"""Base exercise analyzer with shared state machine logic."""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional


class BaseExerciseAnalyzer(ABC):
    """Abstract base for physiotherapy exercise analyzers."""

    exercise_name: str = "Unknown"
    required_joints: List[str] = []

    def __init__(self):
        self.repetitions: int = 0
        self.state: str = "idle"
        self._prev_state: str = "idle"
        self._accuracy_samples: List[float] = []
        self.feedback: List[str] = []

    def reset(self):
        self.repetitions = 0
        self.state = "idle"
        self._prev_state = "idle"
        self._accuracy_samples = []
        self.feedback = []

    def _missing_joints(self, keypoints: Dict) -> List[str]:
        return [j for j in self.required_joints if j not in keypoints]

    def _record_accuracy(self, score: float):
        self._accuracy_samples.append(max(0.0, min(100.0, score)))

    @property
    def accuracy(self) -> float:
        if not self._accuracy_samples:
            return 0.0
        return round(sum(self._accuracy_samples) / len(self._accuracy_samples), 1)

    @abstractmethod
    def analyze(self, keypoints: Dict) -> Dict:
        """Analyze keypoints and return exercise result dict."""

    def _build_result(self, angles: Dict[str, float]) -> Dict:
        return {
            "exercise": self.exercise_name,
            "repetitions": self.repetitions,
            "accuracy": self.accuracy,
            "angles": angles,
            "feedback": self.feedback,
            "state": self.state,
        }
