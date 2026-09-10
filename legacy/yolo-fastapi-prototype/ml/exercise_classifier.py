"""ML module — prepared structure for future models."""

from typing import Any, Dict, List, Optional


class ExerciseClassifier:
    """Placeholder for future exercise classification model."""

    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path
        self.is_loaded = False

    def load(self) -> bool:
        """Load classification model when available."""
        self.is_loaded = False
        return False

    def predict(self, keypoint_sequence: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {
            "exercise": "unknown",
            "confidence": 0.0,
            "status": "model_not_implemented",
        }


class AbnormalMovementDetector:
    """Placeholder for future abnormal movement detection model."""

    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path
        self.is_loaded = False

    def load(self) -> bool:
        self.is_loaded = False
        return False

    def detect(self, angle_history: List[Dict[str, float]]) -> Dict[str, Any]:
        return {
            "abnormal": False,
            "anomaly_score": 0.0,
            "status": "model_not_implemented",
        }


class RecoveryPredictor:
    """Placeholder for future recovery prediction model."""

    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path
        self.is_loaded = False

    def load(self) -> bool:
        self.is_loaded = False
        return False

    def predict(self, session_history: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {
            "recovery_score": None,
            "estimated_weeks": None,
            "status": "model_not_implemented",
        }
