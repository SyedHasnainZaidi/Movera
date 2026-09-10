from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


class UserRegister(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=6)
    role: str = Field(default="patient", pattern="^(patient|therapist)$")


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    name: str
    role: str


class ExerciseResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    class Config:
        from_attributes = True


class SelectExerciseRequest(BaseModel):
    exercise_id: int
    patient_id: Optional[int] = None


class SelectExerciseResponse(BaseModel):
    message: str
    exercise: str
    session_id: int


class KeypointData(BaseModel):
    x: float
    y: float
    confidence: float


class PoseDataResponse(BaseModel):
    detected: bool
    keypoints: Dict[str, KeypointData]
    message: Optional[str] = None


class JointAnglesResponse(BaseModel):
    exercise: str
    angles: Dict[str, float]
    state: str


class ExerciseResultResponse(BaseModel):
    exercise: str
    repetitions: int
    accuracy: float
    angles: Dict[str, float]
    feedback: List[str]
    state: str


class SessionHistoryItem(BaseModel):
    session_id: int
    exercise_name: str
    date: datetime
    repetitions: int
    accuracy_score: float

    class Config:
        from_attributes = True


class PatientHistoryResponse(BaseModel):
    patient_id: int
    patient_name: str
    sessions: List[SessionHistoryItem]


class CameraStartResponse(BaseModel):
    message: str
    status: str
    camera_index: int


class CameraFrameResponse(BaseModel):
    status: str
    frame_base64: Optional[str] = None
    message: Optional[str] = None


class MessageResponse(BaseModel):
    message: str
