"""FastAPI pose-analysis service.

Scope boundary - this service deliberately does NOT:
  * connect to PostgreSQL
  * manage users, registration or login
  * issue application JWTs
  * own patient records
  * compute historical analytics
  * open a camera (`cv2.VideoCapture` appears nowhere in this codebase)

It receives frames from a patient's browser, computes pose geometry, and
reports repetitions to the NestJS backend over an authenticated internal
channel. NestJS remains the sole owner of persistent state.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import analyze, health, websocket_session
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.pose.detector import DetectorPool, ModelNotAvailableError
from app.services.backend_client import BackendClient
from app.state.session_store import SessionStore

logger = logging.getLogger(__name__)

SWEEP_INTERVAL_SECONDS = 60


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)

    logger.info("Starting pose service (environment=%s)", settings.environment)

    pool = DetectorPool(
        settings.model_file,
        max_detectors=settings.pose_max_concurrent_sessions,
        confidence=settings.pose_min_detection_confidence,
        max_people=settings.pose_num_poses,
    )

    # Load the model once at boot so the first patient does not pay the ~0.5 s
    # initialisation cost mid-session. A missing model is logged loudly and
    # /ready reports not-ready - the service never pretends to work without it.
    try:
        load_ms = pool.warm_up()
        logger.info("Pose model warmed up in %.0f ms", load_ms)
    except ModelNotAvailableError as exc:
        logger.error("POSE MODEL MISSING: %s", exc)
    except Exception:  # noqa: BLE001
        logger.exception("Pose model failed to load")

    backend = BackendClient(
        settings.backend_internal_url, settings.pose_service_token
    )
    await backend.start()

    store = SessionStore(
        pool,
        max_sessions=settings.pose_max_concurrent_sessions,
        idle_ttl_seconds=settings.pose_session_ttl_seconds,
        max_session_minutes=settings.pose_max_session_minutes,
    )

    app.state.detector_pool = pool
    app.state.backend_client = backend
    app.state.session_store = store

    async def sweeper() -> None:
        """Reclaim detectors from sessions whose browser vanished."""
        while True:
            try:
                await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
                removed = await store.sweep()
                if removed:
                    logger.info("Swept %d abandoned session(s)", removed)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.exception("Session sweep failed")

    sweep_task = asyncio.create_task(sweeper())

    try:
        yield
    finally:
        sweep_task.cancel()
        try:
            await sweep_task
        except asyncio.CancelledError:
            pass
        await store.shutdown()
        await backend.close()
        logger.info("Pose service stopped")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Movera Pose Analysis Service",
        version="1.0.0",
        description=(
            "Full-body pose analysis for rehabilitation exercise sessions, "
            "built on YOLOv8n-pose (ultralytics).\n\n"
            "**Coordinates.** YOLOv8 returns 17 two-dimensional COCO keypoints "
            "in image pixels. There is no depth, so every joint angle is a "
            "projection into the image plane and depends on camera position - "
            "which is why each exercise declares a required camera view.\n\n"
            "**Clinical disclaimer.** All angle thresholds are prototype "
            "defaults requiring physiotherapist validation. This service "
            "measures deviation from a configured range; it does not diagnose."
            "\n\n**Architecture.** This service holds no database connection "
            "and opens no camera. The patient's webcam lives in their browser; "
            "frames arrive over the WebSocket at `/ws/session`."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    app.include_router(health.router)

    # /analyze is a debug route: it takes an image, runs a full pose inference
    # over it and returns the analysis, with no ticket and no authentication of
    # any kind. That is fine on a developer machine and wrong on a public host,
    # where it hands an anonymous caller a way to spend the instance's CPU at
    # will - the single most expensive operation the service performs, on
    # demand, unmetered.
    #
    # The deployment also keeps it off the public hostname at the reverse proxy
    # (see Caddyfile). Two locks, because either one alone is one configuration
    # mistake away from being the only one.
    if not settings.is_production:
        app.include_router(analyze.router)
    else:
        logging.getLogger(__name__).info(
            "POSE_ENVIRONMENT=production: /analyze debug route not mounted"
        )

    app.include_router(websocket_session.router)

    return app


app = create_app()
