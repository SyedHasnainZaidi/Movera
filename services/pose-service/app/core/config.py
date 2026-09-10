"""Pose service configuration.

Like the backend, this fails fast on a bad environment rather than starting
with a guessed default. The two shared secrets in particular
(POSE_TICKET_SECRET, POSE_SERVICE_TOKEN) have no fallback: without them the
service cannot authenticate anything and must not accept traffic.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=SERVICE_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = Field(default="development", alias="POSE_ENVIRONMENT")
    port: int = Field(default=8000, alias="POSE_SERVICE_PORT")
    log_level: str = Field(default="INFO", alias="POSE_LOG_LEVEL")

    #: Log one line per second per live session showing the primary angle, the
    #: thresholds it must cross and the state machine's position.
    #:
    #: Off by default: it is a diagnostic for "my repetitions are not being
    #: counted", which is otherwise invisible - a movement that stops short of
    #: a threshold produces no repetition AND no error, so nothing is logged at
    #: all. Contains joint angles only; no image data and no patient identifier
    #: beyond the session id.
    rep_diagnostics: bool = Field(default=False, alias="POSE_REP_DIAGNOSTICS")

    # --- security -----------------------------------------------------------
    #: Must match the backend's POSE_TICKET_SECRET. Verifies the browser's
    #: connection ticket. Separate from the backend's user-token secret so
    #: neither token can be replayed against the other service.
    pose_ticket_secret: str = Field(alias="POSE_TICKET_SECRET")
    #: Presented on outbound calls to the backend's /internal endpoints.
    pose_service_token: str = Field(alias="POSE_SERVICE_TOKEN")
    backend_internal_url: str = Field(
        default="http://localhost:3000", alias="BACKEND_INTERNAL_URL"
    )
    #: Browser origins allowed to open the frame WebSocket. Never "*".
    allowed_origins: str = Field(
        default="http://localhost:5173", alias="ALLOWED_ORIGINS"
    )

    # --- model --------------------------------------------------------------
    pose_model_path: str = Field(
        default="app/pose/model/yolov8n-pose.pt",
        alias="POSE_MODEL_PATH",
    )
    #: 2 so MULTIPLE_PEOPLE is actually detectable - see detector.py.
    pose_num_poses: int = Field(default=2, alias="POSE_NUM_POSES")
    pose_min_detection_confidence: float = Field(
        default=0.5, alias="POSE_MIN_DETECTION_CONFIDENCE"
    )
    pose_min_presence_confidence: float = Field(
        default=0.5, alias="POSE_MIN_PRESENCE_CONFIDENCE"
    )
    pose_min_tracking_confidence: float = Field(
        default=0.5, alias="POSE_MIN_TRACKING_CONFIDENCE"
    )

    # --- analysis tuning ----------------------------------------------------
    landmark_visibility_threshold: float = Field(
        default=0.5, alias="LANDMARK_VISIBILITY_THRESHOLD"
    )
    pose_smoothing_window: int = Field(default=5, alias="POSE_SMOOTHING_WINDOW")

    # --- limits -------------------------------------------------------------
    #: A 480px JPEG at quality 0.6 is ~25-40 KB. 2 MB is generous headroom and
    #: still small enough that a hostile client cannot exhaust memory.
    pose_max_frame_bytes: int = Field(
        default=2_000_000, alias="POSE_MAX_FRAME_BYTES"
    )
    pose_session_ttl_seconds: int = Field(
        default=900, alias="POSE_SESSION_TTL_SECONDS"
    )
    pose_max_concurrent_sessions: int = Field(
        default=8, alias="POSE_MAX_CONCURRENT_SESSIONS"
    )
    pose_max_session_minutes: int = Field(
        default=120, alias="POSE_MAX_SESSION_MINUTES"
    )

    @field_validator("pose_ticket_secret", "pose_service_token")
    @classmethod
    def _secret_long_enough(cls, value: str) -> str:
        if len(value) < 32:
            raise ValueError(
                "must be at least 32 characters and match the backend value"
            )
        return value

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def model_file(self) -> Path:
        path = Path(self.pose_model_path)
        return path if path.is_absolute() else SERVICE_ROOT / path

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
