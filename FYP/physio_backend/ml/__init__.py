"""Machine learning module for future model integration."""

from ml.exercise_classifier import (
    AbnormalMovementDetector,
    ExerciseClassifier,
    RecoveryPredictor,
)

__all__ = ["ExerciseClassifier", "AbnormalMovementDetector", "RecoveryPredictor"]
