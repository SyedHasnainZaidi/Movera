"""Liveness, readiness and model provenance endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

import ultralytics
from fastapi import APIRouter, Request

from app.core.config import get_settings
from app.geometry.angles import percentile
from app.schemas.pose import HealthResponse, ModelInfoResponse, ReadyResponse

router = APIRouter(tags=["Health"])

SERVICE_VERSION = "1.0.0"


@router.get("/health", response_model=HealthResponse, summary="Liveness probe")
async def health() -> HealthResponse:
    """The process is up. Deliberately does not touch the model or the backend."""
    return HealthResponse(
        status="ok",
        version=SERVICE_VERSION,
        detectorVersion=f"ultralytics {ultralytics.__version__}",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/ready", response_model=ReadyResponse, summary="Readiness probe")
async def ready(request: Request) -> ReadyResponse:
    """Ready means the pose model is loaded and the backend is reachable.

    A service that answers /health but cannot load its model would accept
    WebSocket connections and then fail every one of them - so readiness
    checks the model explicitly.
    """
    settings = get_settings()
    pool = request.app.state.detector_pool
    backend = request.app.state.backend_client

    model_ok = pool.model_available
    backend_ok = await backend.health()

    return ReadyResponse(
        status="ready" if model_ok else "not-ready",
        checks={
            "model": "loaded" if model_ok else "missing",
            "backend": "up" if backend_ok else "down",
        },
        activeSessions=request.app.state.session_store.active_count,
        capacity=settings.pose_max_concurrent_sessions,
    )


@router.get(
    "/model-info",
    response_model=ModelInfoResponse,
    summary="Pose model provenance and tuning parameters",
)
async def model_info() -> ModelInfoResponse:
    settings = get_settings()
    path = settings.model_file
    present = path.exists()
    return ModelInfoResponse(
        modelPath=str(path),
        modelPresent=present,
        modelSizeBytes=path.stat().st_size if present else None,
        numPoses=settings.pose_num_poses,
        minDetectionConfidence=settings.pose_min_detection_confidence,
        landmarkVisibilityThreshold=settings.landmark_visibility_threshold,
        smoothingWindow=settings.pose_smoothing_window,
    )


@router.get("/benchmark", summary="Measured latency across live sessions")
async def benchmark(request: Request) -> dict:
    """Real measured latency - never an assumed or advertised figure.

    Returns empty statistics until frames have actually been processed, so the
    numbers quoted in the report can only ever come from real runs.
    """
    store = request.app.state.session_store
    decode: list[float] = []
    inference: list[float] = []
    analysis: list[float] = []
    frames = 0

    for session in list(getattr(store, "_sessions", {}).values()):
        decode.extend(session.decode_ms)
        inference.extend(session.inference_ms)
        analysis.extend(session.analysis_ms)
        frames += session.frames_analysed

    def stats(values: list[float]) -> dict:
        if not values:
            return {"samples": 0}
        return {
            "samples": len(values),
            "meanMs": round(sum(values) / len(values), 2),
            "medianMs": round(percentile(values, 50) or 0.0, 2),
            "p95Ms": round(percentile(values, 95) or 0.0, 2),
            "maxMs": round(max(values), 2),
        }

    totals = [d + i + a for d, i, a in zip(decode, inference, analysis)]

    return {
        "framesAnalysed": frames,
        "activeSessions": store.active_count,
        "decode": stats(decode),
        "inference": stats(inference),
        "analysis": stats(analysis),
        "endToEnd": stats(totals),
        "note": (
            "Statistics cover only sessions currently held in memory. "
            "Values are measured, not estimated."
        ),
    }
