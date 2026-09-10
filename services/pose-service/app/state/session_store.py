"""Live session registry.

One `LiveSession` per connected patient. This replaces the superseded FastAPI
prototype's module-level `session_manager` singleton, which held a single
analyzer and a single repetition counter for the entire process - two patients
exercising at once would have shared them.

State here is intentionally in-memory only:

* it is worthless after the session ends;
* it is fully recoverable, because the backend holds the authoritative
  repetition count and a reconnecting analyzer reseeds from it;
* adding Redis to persist a rep counter that PostgreSQL already owns would be
  complexity without benefit at this scale.

The consequence - that horizontal scaling would need session affinity - is
documented in docs/DEPLOYMENT.md rather than pre-solved.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from app.exercises.base import BaseExerciseAnalyzer
from app.pose.detector import DetectorPool, PoseDetector
from app.services.backend_client import AnalyzerContext

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class LiveSession:
    """Everything one connected patient needs, and nothing shared."""

    session_id: str
    patient_profile_id: str
    context: AnalyzerContext
    analyzer: BaseExerciseAnalyzer
    detector: PoseDetector

    created_at: float = field(default_factory=time.monotonic)
    last_frame_at: float = field(default_factory=time.monotonic)
    frames_received: int = 0
    frames_analysed: int = 0
    activated: bool = False

    #: Rolling latency samples for the benchmark endpoint. Bounded so a long
    #: session cannot grow memory without limit.
    decode_ms: list[float] = field(default_factory=list)
    inference_ms: list[float] = field(default_factory=list)
    analysis_ms: list[float] = field(default_factory=list)

    #: Repetitions the pose service counted but could not persist. Surfaced to
    #: the patient rather than silently discarded.
    unpersisted_reps: int = 0

    #: Set once the goal is met and the closing message has been sent, so the
    #: browser is told exactly once however many frames arrive afterwards.
    goal_announced: bool = False
    #: Frame index of the last hold snapshot posted to the backend.
    last_hold_post_frame: int = 0

    def record_latency(self, decode: float, inference: float, analysis: float) -> None:
        for bucket, value in (
            (self.decode_ms, decode),
            (self.inference_ms, inference),
            (self.analysis_ms, analysis),
        ):
            bucket.append(value)
            if len(bucket) > 600:  # ~1 minute at 10 fps
                del bucket[: len(bucket) - 600]

    @property
    def age_seconds(self) -> float:
        return time.monotonic() - self.created_at

    @property
    def idle_seconds(self) -> float:
        return time.monotonic() - self.last_frame_at

    def current_set(self) -> int:
        """Set number for the NEXT repetition, clamped to targetSets.

        Clamping matters: without it, finishing all 30 of a 3x10 prescription
        displays "Set 4 of 3".
        """
        reps_per_set = max(1, self.context.reps_per_set)
        completed = self.analyzer.rep_count
        return min(
            self.context.target_sets,
            completed // reps_per_set + 1,
        )

    def set_number_for_rep(self, rep_number: int) -> int:
        reps_per_set = max(1, self.context.reps_per_set)
        return min(
            self.context.target_sets,
            (rep_number - 1) // reps_per_set + 1,
        )

    def goal_reached(self) -> bool:
        """Has the patient finished what was prescribed?

        The single place that answers this, because the answer depends on the
        prescription (which lives here, on the authoritative context) AND on
        the exercise's goal type. Splitting it would make it possible for the
        two to disagree.

        A HOLD session with no target - a therapist who left the duration
        blank, or an exercise with no default - never auto-completes, and the
        patient finishes it themselves. That is the safe direction: a goal of
        zero seconds would otherwise close the session on the first frame.
        """
        if not self.analyzer.counts_reps:
            hold = self.analyzer.hold
            return hold is not None and hold.target_seconds > 0 and hold.goal_reached
        return (
            self.context.target_total_reps > 0
            and self.analyzer.rep_count >= self.context.target_total_reps
        )


class SessionStore:
    """Registry of live sessions with capacity limits and TTL eviction."""

    def __init__(
        self,
        pool: DetectorPool,
        *,
        max_sessions: int,
        idle_ttl_seconds: int,
        max_session_minutes: int,
    ) -> None:
        self._pool = pool
        self._max_sessions = max_sessions
        self._idle_ttl = idle_ttl_seconds
        self._max_age = max_session_minutes * 60
        self._sessions: dict[str, LiveSession] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        session_id: str,
        patient_profile_id: str,
        context: AnalyzerContext,
        analyzer: BaseExerciseAnalyzer,
    ) -> LiveSession:
        async with self._lock:
            existing = self._sessions.pop(session_id, None)
            if existing is not None:
                # A reconnect for the same session: tear the old one down so a
                # stale socket cannot keep feeding the analyzer.
                logger.info("Replacing existing analyzer for session %s", session_id)
                self._release(existing)

            if len(self._sessions) >= self._max_sessions:
                raise CapacityError(
                    f"The analysis service is at capacity "
                    f"({self._max_sessions} concurrent sessions)."
                )

            detector = self._pool.acquire()
            session = LiveSession(
                session_id=session_id,
                patient_profile_id=patient_profile_id,
                context=context,
                analyzer=analyzer,
                detector=detector,
            )
            self._sessions[session_id] = session
            logger.info(
                "Analyzer attached: session=%s exercise=%s resumeFromRep=%d active=%d",
                session_id,
                context.exercise_slug,
                context.current_persisted_rep_count,
                len(self._sessions),
            )
            return session

    async def get(self, session_id: str) -> Optional[LiveSession]:
        async with self._lock:
            return self._sessions.get(session_id)

    async def remove(self, session_id: str) -> None:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if session is not None:
                self._release(session)
                logger.info(
                    "Analyzer released: session=%s frames=%d active=%d",
                    session_id,
                    session.frames_analysed,
                    len(self._sessions),
                )

    def _release(self, session: LiveSession) -> None:
        try:
            self._pool.release(session.detector)
        except Exception:  # noqa: BLE001 - cleanup must never raise
            logger.debug("Detector release failed", exc_info=True)

    async def sweep(self) -> int:
        """Evict abandoned sessions. Returns how many were removed.

        A browser that is closed without a clean disconnect leaves a session
        holding a detector. Without this, a day of demos would exhaust the pool.
        """
        removed = 0
        async with self._lock:
            for session_id, session in list(self._sessions.items()):
                too_idle = session.idle_seconds > self._idle_ttl
                too_old = session.age_seconds > self._max_age
                if too_idle or too_old:
                    reason = "idle" if too_idle else "max duration"
                    logger.info(
                        "Evicting session %s (%s)", session_id, reason
                    )
                    self._sessions.pop(session_id, None)
                    self._release(session)
                    removed += 1
        return removed

    async def shutdown(self) -> None:
        async with self._lock:
            for session in self._sessions.values():
                self._release(session)
            self._sessions.clear()

    @property
    def active_count(self) -> int:
        return len(self._sessions)

    @property
    def capacity(self) -> int:
        return self._max_sessions


class CapacityError(RuntimeError):
    """Too many concurrent sessions for this machine."""
