"""Exercise session and analyzer management."""

from typing import Dict, Optional

from analysis.base import BaseExerciseAnalyzer
from analysis.bicep_curl import BicepCurlAnalyzer
from analysis.posture import PostureAnalyzer
from analysis.shoulder_abduction import ShoulderAbductionAnalyzer
from analysis.squat import SquatAnalyzer
from analysis.straight_leg_raise import StraightLegRaiseAnalyzer

EXERCISE_ANALYZERS = {
    "squat": SquatAnalyzer,
    "bicep curl": BicepCurlAnalyzer,
    "shoulder abduction": ShoulderAbductionAnalyzer,
    "straight leg raise": StraightLegRaiseAnalyzer,
    "posture": PostureAnalyzer,
}

EXERCISE_NAME_MAP = {
    1: "Squat",
    2: "Bicep Curl",
    3: "Shoulder Abduction",
    4: "Straight Leg Raise",
    5: "Posture",
}


class ExerciseSessionManager:
    """Manages active exercise session and analyzer state."""

    def __init__(self):
        self.active_exercise_id: Optional[int] = None
        self.active_exercise_name: Optional[str] = None
        self.active_session_id: Optional[int] = None
        self.active_patient_id: Optional[int] = None
        self.analyzer: Optional[BaseExerciseAnalyzer] = None
        self.last_result: Dict = {}

    def select_exercise(
        self,
        exercise_id: int,
        exercise_name: str,
        session_id: int,
        patient_id: int,
    ) -> BaseExerciseAnalyzer:
        key = exercise_name.lower().strip()
        analyzer_cls = EXERCISE_ANALYZERS.get(key)
        if analyzer_cls is None:
            raise ValueError(f"Invalid exercise selection: {exercise_name}")

        self.active_exercise_id = exercise_id
        self.active_exercise_name = exercise_name
        self.active_session_id = session_id
        self.active_patient_id = patient_id
        self.analyzer = analyzer_cls()
        self.last_result = {}
        return self.analyzer

    def analyze(self, keypoints: Dict) -> Dict:
        if self.analyzer is None:
            raise ValueError("No exercise selected. Call select-exercise first.")

        result = self.analyzer.analyze(keypoints)
        self.last_result = result
        return result

    def get_analyzer(self) -> Optional[BaseExerciseAnalyzer]:
        return self.analyzer

    def clear(self):
        self.active_exercise_id = None
        self.active_exercise_name = None
        self.active_session_id = None
        self.active_patient_id = None
        self.analyzer = None
        self.last_result = {}


session_manager = ExerciseSessionManager()
