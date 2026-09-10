"""The pose service -> NestJS internal channel.

This service holds NO database connection. Everything durable happens by
calling the backend's `/internal` endpoints with a shared service token.

Repetitions must not be lost. A completed repetition that fails to persist is
work the patient actually did, so ingest is retried with bounded backoff and a
deterministic idempotency key. If it still cannot be persisted the failure is
surfaced to the patient rather than silently dropped.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


class BackendUnavailableError(RuntimeError):
    """The backend could not be reached or rejected the call."""


class SessionRejectedError(RuntimeError):
    """The backend refused this session - do not retry, close the socket."""


@dataclass(frozen=True, slots=True)
class AnalyzerContext:
    """Authoritative session parameters, fetched from the backend.

    The browser never supplies any of this. A client claiming
    `targetReps: 1000` or a relaxed threshold has no effect: the pose service
    asks the backend what the rules are, keyed on the session id inside the
    signed pose ticket.
    """

    session_id: str
    session_status: str
    exercise_slug: str
    exercise_name: str
    rule_config_version: int
    rule_config: dict[str, Any]
    target_sets: int
    reps_per_set: int
    target_total_reps: int
    current_persisted_rep_count: int
    framing_instructions: str
    recommended_view: str
    #: "REPS" or "HOLD". Defaults to REPS so an older backend that does not
    #: send it behaves exactly as before rather than silently switching mode.
    goal_type: str = "REPS"
    #: HOLD only: prescribed seconds of correct alignment, and the seconds
    #: already credited (non-zero when resuming a dropped session).
    target_hold_sec: float = 0.0
    current_held_seconds: float = 0.0

    @property
    def counts_reps(self) -> bool:
        return self.goal_type != "HOLD"

    @staticmethod
    def from_payload(payload: dict[str, Any]) -> "AnalyzerContext":
        return AnalyzerContext(
            session_id=str(payload["sessionId"]),
            session_status=str(payload["sessionStatus"]),
            exercise_slug=str(payload["exerciseSlug"]),
            exercise_name=str(payload.get("exerciseName", payload["exerciseSlug"])),
            rule_config_version=int(payload.get("ruleConfigVersion", 1)),
            rule_config=dict(payload.get("ruleConfig") or {}),
            target_sets=int(payload["targetSets"]),
            reps_per_set=int(payload["repsPerSet"]),
            target_total_reps=int(payload["targetTotalReps"]),
            current_persisted_rep_count=int(
                payload.get("currentPersistedRepCount", 0)
            ),
            framing_instructions=str(payload.get("framingInstructions", "")),
            recommended_view=str(payload.get("recommendedView", "SIDE")),
            goal_type=str(payload.get("goalType", "REPS")),
            target_hold_sec=float(payload.get("targetHoldSec") or 0.0),
            current_held_seconds=float(payload.get("currentHeldSec") or 0.0),
        )


class BackendClient:
    """Thin async client for the backend's internal endpoints."""

    def __init__(
        self,
        base_url: str,
        service_token: str,
        *,
        timeout_seconds: float = 8.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._headers = {
            "x-internal-token": service_token,
            "content-type": "application/json",
        }
        self._timeout = timeout_seconds
        self._client: Optional[httpx.AsyncClient] = None

    async def start(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=self._timeout,
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _require_client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise BackendUnavailableError("Backend client is not started")
        return self._client

    async def fetch_analyzer_context(self, session_id: str) -> AnalyzerContext:
        client = self._require_client()
        url = f"/api/v1/internal/sessions/{session_id}/analyzer-context"
        try:
            response = await client.get(url)
        except httpx.HTTPError as exc:
            raise BackendUnavailableError(
                f"Could not reach the backend: {exc}"
            ) from exc

        if response.status_code in (400, 403, 404, 409):
            # A definitive refusal - the session does not exist, is not owned
            # by this patient, or is already finished. Retrying cannot help.
            raise SessionRejectedError(
                _extract_message(response, "Session is not available for analysis")
            )
        if response.status_code >= 400:
            raise BackendUnavailableError(
                f"Backend returned {response.status_code} for analyzer-context"
            )

        return AnalyzerContext.from_payload(response.json())

    async def activate_session(self, session_id: str) -> None:
        """Move the session CREATED -> ACTIVE.

        Called once, after the analyzer is built and the first valid pose has
        been seen, so a session is only ACTIVE when analysis can genuinely run.
        """
        client = self._require_client()
        url = f"/api/v1/internal/sessions/{session_id}/activate"
        try:
            response = await client.post(url)
        except httpx.HTTPError as exc:
            raise BackendUnavailableError(
                f"Could not activate session: {exc}"
            ) from exc

        if response.status_code in (400, 403, 404, 409):
            raise SessionRejectedError(
                _extract_message(response, "Session could not be activated")
            )
        if response.status_code >= 400:
            raise BackendUnavailableError(
                f"Backend returned {response.status_code} for activate"
            )

    async def ingest_rep(
        self,
        session_id: str,
        payload: dict[str, Any],
        *,
        max_attempts: int = 4,
    ) -> bool:
        """Persist one completed repetition. Returns True when stored.

        Retries with exponential backoff on transport/5xx errors only. The
        `ingestKey` in the payload makes a retry safe: the backend's unique
        constraint turns a duplicate into an idempotent no-op rather than a
        second repetition.

        A 4xx is NOT retried - it means the session is finished or the payload
        is invalid, and hammering the backend would not change that.
        """
        client = self._require_client()
        url = f"/api/v1/internal/sessions/{session_id}/reps"
        delay = 0.25

        for attempt in range(1, max_attempts + 1):
            try:
                response = await client.post(url, json=payload)
            except httpx.HTTPError as exc:
                if attempt == max_attempts:
                    logger.error(
                        "Rep ingest failed after %d attempts for session %s: %s",
                        attempt,
                        session_id,
                        exc,
                    )
                    return False
                await asyncio.sleep(delay)
                delay *= 2
                continue

            if response.status_code < 300:
                return True

            if 400 <= response.status_code < 500:
                logger.warning(
                    "Backend rejected rep %s for session %s: %s %s",
                    payload.get("repNumber"),
                    session_id,
                    response.status_code,
                    _extract_message(response, ""),
                )
                return False

            if attempt == max_attempts:
                logger.error(
                    "Rep ingest gave up after %d attempts (last status %s)",
                    attempt,
                    response.status_code,
                )
                return False

            await asyncio.sleep(delay)
            delay *= 2

        return False

    async def ingest_hold_progress(
        self,
        session_id: str,
        payload: dict[str, Any],
        *,
        max_attempts: int = 3,
    ) -> bool:
        """Post a CUMULATIVE hold snapshot. Returns True when stored.

        Deliberately less defensive than ingest_rep, because it does not need
        to be. Every snapshot restates the whole session, so a failed one is
        superseded by the next a few seconds later - there is no lost work to
        recover, only slightly staler durability. Retries are therefore fewer
        and a permanent failure is logged rather than surfaced to the patient.
        """
        client = self._require_client()
        url = f"/api/v1/internal/sessions/{session_id}/hold"
        delay = 0.25

        for attempt in range(1, max_attempts + 1):
            try:
                response = await client.post(url, json=payload)
            except httpx.HTTPError as exc:
                if attempt == max_attempts:
                    logger.warning(
                        "Hold progress not stored for session %s: %s",
                        session_id,
                        exc,
                    )
                    return False
                await asyncio.sleep(delay)
                delay *= 2
                continue

            if response.status_code < 300:
                return True

            if 400 <= response.status_code < 500:
                logger.warning(
                    "Backend rejected hold progress for session %s: %s %s",
                    session_id,
                    response.status_code,
                    _extract_message(response, ""),
                )
                return False

            if attempt == max_attempts:
                logger.warning(
                    "Hold progress gave up after %d attempts (last status %s)",
                    attempt,
                    response.status_code,
                )
                return False

            await asyncio.sleep(delay)
            delay *= 2

        return False

    async def health(self) -> bool:
        client = self._require_client()
        try:
            response = await client.get("/api/v1/health")
            return response.status_code < 400
        except httpx.HTTPError:
            return False


def _extract_message(response: httpx.Response, fallback: str) -> str:
    try:
        body = response.json()
        if isinstance(body, dict):
            return str(body.get("message") or fallback)
    except Exception:  # noqa: BLE001 - error paths must never raise
        pass
    return fallback
