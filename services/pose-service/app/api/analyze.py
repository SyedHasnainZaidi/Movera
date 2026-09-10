"""Stateless single-frame analysis.

Exists so the pose pipeline is demonstrable and testable without a browser,
webcam or backend: useful in Swagger, in automated tests, and when showing a
supervisor what the service actually computes from one still image.

This is NOT the production path. Live sessions use the WebSocket in
websocket_session.py, which streams raw JPEG bytes (base64 costs 33% more
bandwidth) and, unlike this endpoint, is stateful - repetition counting needs
memory of previous frames and cannot work one isolated image at a time.
"""

from __future__ import annotations

import base64
import binascii
import time

from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import get_settings
from app.exercises.base import RuleConfig
from app.exercises.registry import build_analyzer
from app.pose.detector import select_primary_pose
from app.schemas.pose import (
    AnalyzeRequest,
    ErrorDto,
    LandmarkDto,
    LatencyDto,
    PoseAnalysisData,
    PostureDto,
    RepDto,
)
from app.services.frame_decoder import FrameDecodeError, decode_frame

router = APIRouter(tags=["Analysis"])

#: Demonstration rule configs so /analyze works standalone.
#:
#: PROTOTYPE DEFAULTS - these mirror the seeded ExerciseRuleConfig rows but are
#: NOT the authoritative source. A live session always fetches its rules from
#: the backend, so a client cannot influence how it is judged.
DEMO_RULE_CONFIGS: dict[str, dict] = {
    "squat": {
        "requiredLandmarks": [
            "left_hip", "right_hip", "left_knee", "right_knee",
            "left_ankle", "right_ankle", "left_shoulder", "right_shoulder",
        ],
        "angleDefinitions": {
            "leftKnee": {"type": "joint", "a": "left_hip", "b": "left_knee", "c": "left_ankle"},
            "rightKnee": {"type": "joint", "a": "right_hip", "b": "right_knee", "c": "right_ankle"},
            "knee": {"type": "average", "of": ["leftKnee", "rightKnee"]},
            "trunkLean": {"type": "vertical", "upper": "mid_shoulder", "lower": "mid_hip"},
        },
        "movementStateConfig": {
            "primaryAngle": "knee",
            "direction": "DECREASING",
            "restAngle": 160,
            "peakAngle": 100,
        },
        "postureRules": [
            {"code": "TRUNK_LEAN", "angle": "trunkLean", "max": 40, "joint": "trunk"}
        ],
        "minVisibility": 0.5,
        "repCorrectnessThreshold": 70,
    },
    "bicep-curl": {
        "requiredLandmarks": [
            "left_shoulder", "right_shoulder", "left_elbow",
            "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip",
        ],
        "angleDefinitions": {
            "leftElbow": {"type": "joint", "a": "left_shoulder", "b": "left_elbow", "c": "left_wrist"},
            "rightElbow": {"type": "joint", "a": "right_shoulder", "b": "right_elbow", "c": "right_wrist"},
            "elbow": {"type": "average", "of": ["leftElbow", "rightElbow"]},
        },
        "movementStateConfig": {
            "primaryAngle": "elbow",
            "direction": "DECREASING",
            "restAngle": 150,
            "peakAngle": 55,
        },
        "postureRules": [],
        "minVisibility": 0.5,
        "repCorrectnessThreshold": 70,
    },
    "shoulder-raise": {
        "requiredLandmarks": [
            "left_shoulder", "right_shoulder", "left_elbow",
            "right_elbow", "left_hip", "right_hip",
        ],
        "angleDefinitions": {
            "leftShoulder": {"type": "joint", "a": "left_hip", "b": "left_shoulder", "c": "left_elbow"},
            "rightShoulder": {"type": "joint", "a": "right_hip", "b": "right_shoulder", "c": "right_elbow"},
            "shoulder": {"type": "average", "of": ["leftShoulder", "rightShoulder"]},
        },
        "movementStateConfig": {
            "primaryAngle": "shoulder",
            "direction": "INCREASING",
            "restAngle": 30,
            "peakAngle": 85,
        },
        "postureRules": [],
        "minVisibility": 0.5,
        "repCorrectnessThreshold": 70,
    },
}


@router.post(
    "/analyze",
    response_model=PoseAnalysisData,
    summary="Analyse a single frame (debug / testing only)",
)
async def analyze_frame(payload: AnalyzeRequest, request: Request) -> PoseAnalysisData:
    settings = get_settings()

    rules = DEMO_RULE_CONFIGS.get(payload.exerciseSlug)
    if rules is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No demo configuration for '{payload.exerciseSlug}'. "
                f"Available: {', '.join(sorted(DEMO_RULE_CONFIGS))}"
            ),
        )

    try:
        raw = base64.b64decode(payload.frameBase64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="frameBase64 is not valid base64.",
        ) from exc

    decode_started = time.perf_counter()
    try:
        frame = decode_frame(raw, max_bytes=settings.pose_max_frame_bytes)
    except FrameDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    decode_ms = (time.perf_counter() - decode_started) * 1000.0

    config = RuleConfig.from_payload(
        {"exerciseSlug": payload.exerciseSlug, "ruleConfigVersion": 0, **rules}
    )
    analyzer = build_analyzer(config)

    pool = request.app.state.detector_pool
    detector = pool.acquire()
    try:
        poses, people, inference_ms = detector.detect(frame)
    finally:
        pool.release(detector)

    primary = select_primary_pose(poses)

    analysis_started = time.perf_counter()
    analysis = analyzer.analyze(primary, people_detected=people)
    analysis_ms = (time.perf_counter() - analysis_started) * 1000.0

    landmarks = []
    if primary is not None:
        landmarks = [
            LandmarkDto(
                name=name.value,
                x=round(point.x, 4),
                y=round(point.y, 4),
                visibility=round(point.confidence, 3),
            )
            for name, point in primary.normalized.items()
        ]

    return PoseAnalysisData(
        sessionId="debug",
        exercise=payload.exerciseSlug,
        frameIndex=payload.frameIndex,
        personDetected=people > 0,
        peopleDetected=people,
        trackingValid=analysis.tracking_valid,
        confidence=analysis.confidence,
        landmarks=landmarks,
        missingLandmarks=analysis.missing_landmarks,
        angles=analysis.angles,
        movementState=analysis.movement_state.value,
        stateHeldMs=analysis.state_held_ms,
        rep=RepDto(count=analysis.rep_count, targetCount=0),
        posture=PostureDto(
            correct=analysis.posture_correct, score=analysis.posture_score
        ),
        errors=[
            ErrorDto(
                code=e.to_dict()["code"],
                severity=e.to_dict()["severity"],
                message=e.to_dict()["message"],
                joint=e.to_dict().get("joint"),
                observed=e.to_dict().get("observed"),
                expected=e.to_dict().get("expected"),
            )
            for e in analysis.errors
        ],
        latencyMs=LatencyDto(
            decode=round(decode_ms, 2),
            inference=round(inference_ms, 2),
            analysis=round(analysis_ms, 2),
            total=round(decode_ms + inference_ms + analysis_ms, 2),
        ),
    )
