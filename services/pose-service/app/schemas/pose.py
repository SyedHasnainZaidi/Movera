"""Pydantic v2 models for the pose service wire contract.

This is the authoritative definition of the shape the browser receives. The
frontend's TypeScript types mirror it exactly, and any change here must be
mirrored in apps/frontend/src/features/session/types.ts and in
docs/POSE_SERVICE.md.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field


class LandmarkDto(BaseModel):
    """One keypoint in NORMALIZED coordinates, for drawing the overlay.

    Pixel coordinates are used server-side for angles but never sent: they
    describe the frame that was analysed, not the one the browser is showing.

    No z. YOLOv8 pose returns 17 two-dimensional COCO keypoints and measures no
    depth at all, so the field the MediaPipe landmarker used to fill has been
    removed rather than sent as a constant zero.
    """

    name: str
    x: float
    y: float
    #: YOLO's per-keypoint confidence in [0,1]. Named `visibility` because that
    #: is what the browser overlay already reads it as.
    visibility: float


class ErrorDto(BaseModel):
    code: str
    severity: Literal["info", "warning", "critical"]
    message: str
    joint: Optional[str] = None
    observed: Optional[float] = None
    expected: Optional[dict[str, float]] = None


class RepDto(BaseModel):
    completed: bool = False
    count: int = 0
    targetCount: int = 0
    currentSet: int = 1
    targetSets: int = 1
    lastRepScore: Optional[float] = None


class HoldDto(BaseModel):
    """Progress for a HOLD exercise. Absent entirely on REPS exercises.

    Present instead of - not alongside - meaningful rep numbers: an exercise
    with no countable repetition reports `rep.count` 0 forever, and the browser
    shows this panel in the counter's place.
    """

    heldSeconds: float = 0.0
    targetSeconds: float = 0.0
    remainingSeconds: float = 0.0
    #: Completion in [0, 1].
    progress: float = 0.0
    #: Whether the patient is correctly aligned right now.
    active: bool = False
    #: Seconds in the current unbroken stretch, for live encouragement.
    streakSeconds: float = 0.0
    bestStreakSeconds: float = 0.0


class PostureDto(BaseModel):
    correct: bool = False
    score: float = 0.0


class LatencyDto(BaseModel):
    decode: float = 0.0
    inference: float = 0.0
    analysis: float = 0.0
    total: float = 0.0


class PoseAnalysisData(BaseModel):
    sessionId: str
    exercise: str
    frameIndex: int

    personDetected: bool
    peopleDetected: int
    trackingValid: bool
    #: Mean visibility of the landmarks this exercise requires. A measure of
    #: how well the camera can see the patient - NOT an accuracy figure.
    confidence: float

    landmarks: list[LandmarkDto] = Field(default_factory=list)
    missingLandmarks: list[str] = Field(default_factory=list)
    angles: dict[str, float] = Field(default_factory=dict)

    movementState: str
    stateHeldMs: float

    #: Which of `rep` and `hold` carries this exercise's progress.
    goalType: Literal["REPS", "HOLD"] = "REPS"
    rep: RepDto
    hold: Optional[HoldDto] = None
    posture: PostureDto
    errors: list[ErrorDto] = Field(default_factory=list)
    latencyMs: LatencyDto
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class PoseUpdateMessage(BaseModel):
    """Server -> browser, once per analysed frame."""

    type: Literal["pose:update"] = "pose:update"
    data: PoseAnalysisData


class RepCompletedData(BaseModel):
    sessionId: str
    repNumber: int
    setNumber: int
    correct: bool
    score: float
    trackingConfidence: float
    totalReps: int
    targetTotalReps: int
    angleSummary: dict[str, dict[str, float]] = Field(default_factory=dict)
    persisted: bool = False


class RepCompletedMessage(BaseModel):
    """Server -> browser, once per completed repetition."""

    type: Literal["rep:completed"] = "rep:completed"
    data: RepCompletedData


class TrackingWarningData(BaseModel):
    code: str
    severity: str
    message: str


class TrackingWarningMessage(BaseModel):
    type: Literal["tracking:warning"] = "tracking:warning"
    data: TrackingWarningData


class SessionReadyData(BaseModel):
    sessionId: str
    exercise: str
    targetSets: int
    repsPerSet: int
    targetTotalReps: int
    #: Repetitions already persisted by the backend. On a reconnect this is
    #: non-zero and the analyzer resumes from it instead of restarting at 1.
    resumedFromRep: int
    ruleConfigVersion: int
    framingInstructions: str
    recommendedView: str
    #: REPS or HOLD. The browser uses this to decide whether to show a
    #: repetition counter or a hold timer, before any frame has been analysed.
    goalType: Literal["REPS", "HOLD"] = "REPS"
    #: HOLD only: prescribed seconds, and seconds already credited on a resume.
    targetHoldSeconds: float = 0.0
    resumedFromHeldSeconds: float = 0.0


class SessionReadyMessage(BaseModel):
    type: Literal["session:ready"] = "session:ready"
    data: SessionReadyData


class PoseErrorData(BaseModel):
    code: str
    message: str
    recoverable: bool = True


class PoseErrorMessage(BaseModel):
    type: Literal["pose:error"] = "pose:error"
    data: PoseErrorData


class SessionClosedData(BaseModel):
    """Sent once, when the pose service decides the session is finished.

    The browser reacts by finalising the session and showing the report, so
    this carries enough detail to explain WHY without a further round trip.
    """

    sessionId: str
    #: GOAL_REACHED is the only reason today. Kept as an open string so a
    #: future reason (an abandoned session, a therapist stop) does not require
    #: a coordinated deploy of both services.
    reason: str
    goalType: Literal["REPS", "HOLD"] = "REPS"
    #: Repetitions completed, for a REPS session.
    totalReps: int = 0
    targetTotalReps: int = 0
    #: Seconds held, for a HOLD session.
    heldSeconds: float = 0.0
    targetHoldSeconds: float = 0.0


class SessionClosedMessage(BaseModel):
    type: Literal["session:closed"] = "session:closed"
    data: SessionClosedData


# --- debug endpoint -------------------------------------------------------


class AnalyzeRequest(BaseModel):
    """Stateless single-frame analysis, for Swagger and automated tests.

    Production traffic uses the WebSocket with raw JPEG bytes; base64 costs
    33% more bandwidth for no benefit at 10 frames per second.
    """

    exerciseSlug: str = Field(examples=["squat"])
    frameBase64: str = Field(description="Base64-encoded JPEG or PNG frame")
    frameIndex: int = 0


class HealthResponse(BaseModel):
    status: str
    service: str = "physio-pose-service"
    version: str
    detectorVersion: str
    timestamp: str


class ReadyResponse(BaseModel):
    status: str
    checks: dict[str, str]
    activeSessions: int
    capacity: int


class ModelInfoResponse(BaseModel):
    modelPath: str
    modelPresent: bool
    modelSizeBytes: Optional[int] = None
    numPoses: int
    minDetectionConfidence: float
    landmarkVisibilityThreshold: float
    smoothingWindow: int
    source: str = (
        "https://github.com/ultralytics/assets/releases (yolov8n-pose.pt)"
    )
    licence: str = "AGPL-3.0 (Ultralytics YOLOv8)"
