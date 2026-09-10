"""The live frame stream: browser <-> pose service.

Connection lifecycle
--------------------
    1. Browser connects with ?ticket=<short-lived JWT>
    2. Ticket verified (signature, expiry, scope, session id)
    3. Origin checked against ALLOWED_ORIGINS
    4. Backend asked for the AUTHORITATIVE analyzer context
    5. Analyzer built, seeded with the persisted repetition count
    6. session:ready sent
    7. Frames flow in; pose:update flows back
    8. First frame with a valid, fully-visible pose -> session ACTIVE
    9. Each completed repetition -> persisted via the backend, then rep:completed
   10. Disconnect -> detector released

Ticket expiry after connection
------------------------------
The ticket authorises *establishing* the connection. It is not re-checked per
frame: expiring a legitimate 3-minute exercise session because a 2-minute
ticket lapsed would be hostile. A separate absolute cap
(POSE_MAX_SESSION_MINUTES) stops a forgotten socket living forever.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.security import InvalidTicketError, verify_pose_ticket
from app.exercises.base import FrameAnalysis, RuleConfig
from app.exercises.registry import build_analyzer, is_supported
from app.feedback.codes import ErrorCode
from app.landmarks.registry import PoseFrame
from app.pose.detector import select_primary_pose
from app.schemas.pose import (
    ErrorDto,
    HoldDto,
    LandmarkDto,
    LatencyDto,
    PoseAnalysisData,
    PoseErrorData,
    PoseErrorMessage,
    PostureDto,
    PoseUpdateMessage,
    RepCompletedData,
    RepCompletedMessage,
    RepDto,
    SessionClosedData,
    SessionClosedMessage,
    SessionReadyData,
    SessionReadyMessage,
)
from app.services.backend_client import (
    BackendUnavailableError,
    SessionRejectedError,
)
from app.services.frame_decoder import FrameDecodeError, decode_frame
from app.state.session_store import CapacityError, LiveSession

logger = logging.getLogger(__name__)
router = APIRouter()

# WebSocket close codes (4000-4999 is the application-defined range).
WS_INVALID_TICKET = 4401
WS_FORBIDDEN_ORIGIN = 4403
WS_SESSION_REJECTED = 4404
WS_BACKEND_UNAVAILABLE = 4503
WS_AT_CAPACITY = 4429
WS_UNSUPPORTED_EXERCISE = 4422


class ControlMessage(BaseModel):
    type: str
    action: Optional[str] = None


@router.websocket("/ws/session")
async def pose_session_socket(
    websocket: WebSocket,
    ticket: str = Query(default=""),
) -> None:
    settings: Settings = get_settings()
    store = websocket.app.state.session_store
    backend = websocket.app.state.backend_client

    # --- 1. origin allowlist ---------------------------------------------
    origin = websocket.headers.get("origin")
    if origin and origin not in settings.origins:
        logger.warning("Rejected WebSocket from disallowed origin: %s", origin)
        await websocket.close(code=WS_FORBIDDEN_ORIGIN, reason="Origin not allowed")
        return

    # --- 2. ticket --------------------------------------------------------
    try:
        pose_ticket = verify_pose_ticket(ticket, settings.pose_ticket_secret)
    except InvalidTicketError as exc:
        # The ticket value itself is never logged.
        logger.info("Rejected WebSocket: %s", exc)
        await websocket.close(code=WS_INVALID_TICKET, reason=str(exc))
        return

    await websocket.accept()
    session_id = pose_ticket.session_id

    # --- 3. authoritative context from the backend ------------------------
    try:
        context = await backend.fetch_analyzer_context(session_id)
    except SessionRejectedError as exc:
        await _send_error(websocket, "SESSION_REJECTED", str(exc), recoverable=False)
        await websocket.close(code=WS_SESSION_REJECTED, reason=str(exc))
        return
    except BackendUnavailableError as exc:
        logger.error("Backend unavailable for session %s: %s", session_id, exc)
        await _send_error(
            websocket,
            "BACKEND_UNAVAILABLE",
            "Could not reach the application server. Please try again.",
            recoverable=True,
        )
        await websocket.close(code=WS_BACKEND_UNAVAILABLE)
        return

    if not is_supported(context.exercise_slug):
        message = f"Exercise '{context.exercise_slug}' has no analyzer."
        await _send_error(websocket, "UNSUPPORTED_EXERCISE", message, recoverable=False)
        await websocket.close(code=WS_UNSUPPORTED_EXERCISE, reason=message)
        return

    # --- 4. build the analyzer -------------------------------------------
    try:
        rule_config = RuleConfig.from_payload(
            {
                **context.rule_config,
                # Spread FIRST so these win. Identity, version, goal type and
                # duration are prescription, not analysis thresholds: they come
                # from the session row and a stale rule config must not be able
                # to override them.
                "exerciseSlug": context.exercise_slug,
                "ruleConfigVersion": context.rule_config_version,
                "goalType": context.goal_type,
                "targetHoldSeconds": context.target_hold_sec,
            }
        )
    except (KeyError, ValueError) as exc:
        logger.error("Invalid rule config for %s: %s", context.exercise_slug, exc)
        await _send_error(
            websocket,
            "INVALID_RULE_CONFIG",
            "This exercise is not configured correctly. Contact your therapist.",
            recoverable=False,
        )
        await websocket.close(code=WS_UNSUPPORTED_EXERCISE)
        return

    analyzer = build_analyzer(
        rule_config,
        initial_rep_count=context.current_persisted_rep_count,
        initial_held_seconds=context.current_held_seconds,
    )

    try:
        session = await store.create(
            session_id, pose_ticket.patient_profile_id, context, analyzer
        )
    except (CapacityError, Exception) as exc:  # noqa: BLE001
        if isinstance(exc, CapacityError):
            await _send_error(websocket, "AT_CAPACITY", str(exc), recoverable=True)
            await websocket.close(code=WS_AT_CAPACITY, reason=str(exc))
            return
        logger.exception("Failed to create analyzer session")
        await _send_error(
            websocket,
            "ANALYZER_INIT_FAILED",
            "Pose analysis could not start. Please try again.",
            recoverable=True,
        )
        await websocket.close(code=WS_BACKEND_UNAVAILABLE)
        return

    await _send(
        websocket,
        SessionReadyMessage(
            data=SessionReadyData(
                sessionId=session_id,
                exercise=context.exercise_slug,
                targetSets=context.target_sets,
                repsPerSet=context.reps_per_set,
                targetTotalReps=context.target_total_reps,
                resumedFromRep=context.current_persisted_rep_count,
                ruleConfigVersion=context.rule_config_version,
                framingInstructions=context.framing_instructions,
                recommendedView=context.recommended_view,
                goalType="HOLD" if not analyzer.counts_reps else "REPS",
                targetHoldSeconds=context.target_hold_sec,
                resumedFromHeldSeconds=context.current_held_seconds,
            )
        ),
    )

    # --- 5. frame loop ----------------------------------------------------
    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if (payload := message.get("bytes")) is not None:
                await _handle_frame(websocket, session, payload, settings, backend)
            elif (text := message.get("text")) is not None:
                await _handle_control(websocket, session, text)

    except WebSocketDisconnect:
        logger.info("Client disconnected from session %s", session_id)
    except Exception:  # noqa: BLE001
        logger.exception("Unhandled error in session %s", session_id)
        await _send_error(
            websocket,
            "INTERNAL_ERROR",
            "Pose analysis stopped unexpectedly.",
            recoverable=True,
        )
    finally:
        await store.remove(session_id)


async def _handle_frame(
    websocket: WebSocket,
    session: LiveSession,
    payload: bytes,
    settings: Settings,
    backend,
) -> None:
    session.frames_received += 1
    session.last_frame_at = time.monotonic()

    # --- decode ---
    decode_started = time.perf_counter()
    try:
        frame = decode_frame(payload, max_bytes=settings.pose_max_frame_bytes)
    except FrameDecodeError as exc:
        logger.debug("Frame decode failed: %s", exc)
        # A bad frame is skipped, never fatal - one corrupt packet must not end
        # a patient's session.
        await _send(
            websocket,
            PoseErrorMessage(
                data=PoseErrorData(
                    code=ErrorCode.FRAME_DECODE_ERROR.value,
                    message="A video frame was skipped. Analysis is continuing.",
                    recoverable=True,
                )
            ),
        )
        return
    decode_ms = (time.perf_counter() - decode_started) * 1000.0

    # --- inference ---
    poses, people, inference_ms = session.detector.detect(frame)
    primary = select_primary_pose(poses)

    # --- analysis ---
    analysis_started = time.perf_counter()
    analysis: FrameAnalysis = session.analyzer.analyze(
        primary, people_detected=people
    )
    analysis_ms = (time.perf_counter() - analysis_started) * 1000.0

    session.frames_analysed += 1
    session.record_latency(decode_ms, inference_ms, analysis_ms)

    _log_rep_diagnostics(session, analysis)

    # --- activate on the first genuinely analysable frame ---
    if not session.activated and analysis.tracking_valid:
        try:
            await backend.activate_session(session.session_id)
            session.activated = True
            logger.info("Session %s is now ACTIVE", session.session_id)
        except SessionRejectedError as exc:
            await _send_error(
                websocket, "SESSION_REJECTED", str(exc), recoverable=False
            )
            await websocket.close(code=WS_SESSION_REJECTED)
            return
        except BackendUnavailableError:
            # Keep analysing and retry on a later frame - the patient sees live
            # feedback either way, and repetitions are held until it succeeds.
            logger.warning(
                "Could not activate session %s yet; will retry", session.session_id
            )

    # --- repetition completed (REPS exercises only) ---
    rep_payload: Optional[RepCompletedData] = None
    if analysis.rep_event is not None:
        rep_payload = await _persist_rep(session, analysis, backend)

    # --- hold progress (HOLD exercises only) ---
    if analysis.hold is not None:
        await _persist_hold(session, backend)

    await _send(
        websocket,
        PoseUpdateMessage(
            data=_build_update(
                session,
                analysis,
                primary,
                people,
                decode_ms,
                inference_ms,
                analysis_ms,
            )
        ),
    )

    if rep_payload is not None:
        await _send(websocket, RepCompletedMessage(data=rep_payload))

    # --- the session finishes itself -------------------------------------
    #
    # Checked on every frame rather than only after a repetition, because a
    # hold exercise completes without any repetition ever occurring. Announced
    # exactly once: frames keep arriving until the browser has torn the camera
    # down, and repeating the message would restart the client's finish
    # sequence several times over.
    if not session.goal_announced and session.goal_reached():
        session.goal_announced = True
        if analysis.hold is not None:
            # Flush the final snapshot before the backend finalises the
            # session, so the report is built from the completed hold rather
            # than from whatever the last periodic post happened to contain.
            await _persist_hold(session, backend, force=True)
        await _send(
            websocket,
            SessionClosedMessage(
                data=SessionClosedData(
                    sessionId=session.session_id,
                    reason="GOAL_REACHED",
                    goalType="REPS" if session.analyzer.counts_reps else "HOLD",
                    totalReps=session.analyzer.rep_count,
                    targetTotalReps=session.context.target_total_reps,
                    heldSeconds=round(
                        analysis.hold.held_seconds if analysis.hold else 0.0, 1
                    ),
                    targetHoldSeconds=session.context.target_hold_sec,
                )
            ),
        )


async def _persist_rep(
    session: LiveSession, analysis: FrameAnalysis, backend
) -> RepCompletedData:
    """Flush the repetition's statistics and send them to the backend."""
    event = analysis.rep_event
    assert event is not None

    score, confidence, angle_summary, error_counts = session.analyzer.flush_rep()
    correct = session.analyzer.is_rep_correct(score, error_counts)
    set_number = session.set_number_for_rep(event.rep_number)

    now = time.time()
    started_at = now - (event.completed_at - event.started_at)

    payload = {
        # Deterministic: a retry produces the same key, and the backend's unique
        # constraint turns the duplicate into an idempotent no-op.
        "ingestKey": f"{session.session_id}:{event.rep_number}",
        "repNumber": event.rep_number,
        "setNumber": set_number,
        "startedAt": _iso(started_at),
        "completedAt": _iso(now),
        "correct": correct,
        "score": round(score, 2),
        "trackingConfidence": round(confidence, 3),
        "angleSummary": angle_summary,
        "errors": [
            {"code": code, "occurrences": count}
            for code, count in error_counts.items()
        ],
    }

    persisted = await backend.ingest_rep(session.session_id, payload)
    if not persisted:
        session.unpersisted_reps += 1
        logger.error(
            "Repetition %d of session %s could not be persisted",
            event.rep_number,
            session.session_id,
        )

    return RepCompletedData(
        sessionId=session.session_id,
        repNumber=event.rep_number,
        setNumber=set_number,
        correct=correct,
        score=round(score, 1),
        trackingConfidence=round(confidence, 3),
        totalReps=session.analyzer.machine.rep_count,
        targetTotalReps=session.context.target_total_reps,
        angleSummary=angle_summary,
        persisted=persisted,
    )


#: How often a HOLD session's cumulative progress is written to the backend,
#: in analysed frames. At ~7 fps this is roughly every five seconds.
#:
#: Frequent enough that a browser crash costs a patient only a few seconds of
#: credited time, rare enough that a 60-second exercise makes ~12 writes rather
#: than 420. Each snapshot is a complete restatement, so the interval trades
#: durability against write volume and nothing else.
_HOLD_POST_EVERY_N_FRAMES = 35


async def _persist_hold(
    session: LiveSession, backend, *, force: bool = False
) -> None:
    """Post the cumulative hold snapshot, on an interval or on demand."""
    # The backend accepts progress only for an ACTIVE session, and a session
    # becomes ACTIVE on its first analysable frame. A patient who spends five
    # seconds walking into shot would otherwise trigger a snapshot while the
    # session is still CREATED, and every one of those is refused with a 409
    # logged as a warning. There is nothing to report before activation anyway:
    # held time accrues only on frames that are valid enough to activate.
    if not session.activated:
        return

    due = (
        session.frames_analysed - session.last_hold_post_frame
        >= _HOLD_POST_EVERY_N_FRAMES
    )
    if not force and not due:
        return
    # Recorded before awaiting, so a slow backend cannot queue a second post.
    session.last_hold_post_frame = session.frames_analysed

    summary = session.analyzer.hold_summary()
    await backend.ingest_hold_progress(
        session.session_id,
        {
            "heldSec": summary["heldSeconds"],
            "bestStreakSec": summary["bestStreakSeconds"],
            "analysedFrames": summary["analysedFrames"],
            "meanScore": summary["meanScore"],
            "meanConfidence": summary["meanConfidence"],
            "angleSummary": summary["angleStats"],
            "errors": summary["errors"],
        },
    )


#: Log one diagnostic line per this many analysed frames. At the 10 fps the
#: browser samples at, 10 frames is roughly one line per second - enough to see
#: the shape of a movement without flooding the console.
_DIAGNOSTIC_EVERY_N_FRAMES = 10


def _log_rep_diagnostics(session: LiveSession, analysis: FrameAnalysis) -> None:
    """Print what the repetition counter is actually seeing.

    Enabled with POSE_REP_DIAGNOSTICS=1.

    When a patient reports "it is not counting my reps", the missing
    information is always the same: what angle did they actually reach, and
    which state did the machine get stuck in. The rep counter needs a FULL
    cycle - rest -> peak -> rest - and a movement that stops a few degrees
    short of either threshold produces no repetition and no error, which looks
    identical to the app being broken.

    This line makes the difference visible: it prints the live primary angle
    alongside the two thresholds it has to cross, plus the per-limb angles so
    that a limb which never straightens (and therefore holds a `min` primary
    below the rest threshold forever) is obvious at a glance.
    """
    if session.frames_analysed % _DIAGNOSTIC_EVERY_N_FRAMES != 0:
        return
    # get_settings() is cached, so this costs nothing on the hot path.
    if not get_settings().rep_diagnostics:
        return

    if analysis.hold is not None:
        # A hold exercise has no cycle, no thresholds to cross and no rep
        # count. What matters when it "is not working" is whether the clock is
        # running and which rule is stopping it.
        blocking = [e.code.value for e in analysis.errors]
        logger.info(
            "HOLDDIAG frame=%d aligned=%s held=%.1f/%.0fs streak=%.1fs "
            "tracking=%s blocking=%s",
            session.frames_analysed,
            analysis.hold.active,
            analysis.hold.held_seconds,
            analysis.hold.target_seconds,
            analysis.hold.streak_seconds,
            "ok" if analysis.tracking_valid else "INVALID",
            ",".join(blocking) if blocking else "-",
        )
        return

    config = session.analyzer.config.movement
    primary = analysis.angles.get(config.primary_angle)
    machine = session.analyzer.machine

    parts = [
        f"frame={session.frames_analysed}",
        f"state={analysis.movement_state.value}",
        f"reps={machine.rep_count}",
        f"tracking={'ok' if analysis.tracking_valid else 'INVALID'}",
        f"{config.primary_angle}="
        + (f"{primary:.1f}" if primary is not None else "n/a"),
        f"(rest>={config.rest_angle:.0f} peak<={config.peak_angle:.0f})"
        if config.direction.value == "DECREASING"
        else f"(rest<={config.rest_angle:.0f} peak>={config.peak_angle:.0f})",
    ]

    # Per-limb values, so a single stiff arm holding the combined angle back is
    # immediately visible rather than being averaged or min-ed out of sight.
    limbs = {
        name: value
        for name, value in analysis.angles.items()
        if name.startswith(("left", "right"))
    }
    if limbs:
        parts.append(
            "limbs=" + " ".join(
                f"{n}={v:.0f}" if v is not None else f"{n}=n/a"
                for n, v in sorted(limbs.items())
            )
        )

    logger.info("REPDIAG %s", " ".join(parts))


def _build_update(
    session: LiveSession,
    analysis: FrameAnalysis,
    pose: Optional[PoseFrame],
    people_detected: int,
    decode_ms: float,
    inference_ms: float,
    analysis_ms: float,
) -> PoseAnalysisData:
    """Assemble the per-frame payload sent to the browser.

    Only NORMALIZED coordinates are sent: they are what the canvas overlay
    needs, and they scale to whatever size the video element happens to be.
    Raw pixel coordinates stay server-side - they are meaningful only in the
    frame that was analysed, which is not the frame the browser is displaying.

    There is no z. YOLOv8 pose is a 2-D detector; the MediaPipe landmarker this
    replaced supplied depth, and sending a constant 0.0 in its place would be a
    field that looks like data and is not.
    """
    landmarks: list[LandmarkDto] = []
    if pose is not None:
        for name, point in pose.normalized.items():
            landmarks.append(
                LandmarkDto(
                    name=name.value,
                    x=round(point.x, 4),
                    y=round(point.y, 4),
                    visibility=round(point.confidence, 3),
                )
            )

    return PoseAnalysisData(
        sessionId=session.session_id,
        exercise=session.context.exercise_slug,
        frameIndex=session.frames_analysed,
        personDetected=people_detected > 0,
        peopleDetected=people_detected,
        trackingValid=analysis.tracking_valid,
        confidence=analysis.confidence,
        landmarks=landmarks,
        missingLandmarks=analysis.missing_landmarks,
        angles=analysis.angles,
        movementState=analysis.movement_state.value,
        stateHeldMs=analysis.state_held_ms,
        goalType="REPS" if session.analyzer.counts_reps else "HOLD",
        rep=RepDto(
            completed=analysis.rep_event is not None,
            count=analysis.rep_count,
            targetCount=session.context.target_total_reps,
            currentSet=session.current_set(),
            targetSets=session.context.target_sets,
        ),
        hold=(
            HoldDto(**analysis.hold.to_dict()) if analysis.hold is not None else None
        ),
        posture=PostureDto(
            correct=analysis.posture_correct,
            score=analysis.posture_score,
        ),
        errors=[ErrorDto(**_error_to_dto(e)) for e in analysis.errors],
        latencyMs=LatencyDto(
            decode=round(decode_ms, 2),
            inference=round(inference_ms, 2),
            analysis=round(analysis_ms, 2),
            total=round(decode_ms + inference_ms + analysis_ms, 2),
        ),
    )


def _error_to_dto(error) -> dict:
    payload = error.to_dict()
    return {
        "code": payload["code"],
        "severity": payload["severity"],
        "message": payload["message"],
        "joint": payload.get("joint"),
        "observed": payload.get("observed"),
        "expected": payload.get("expected"),
    }


async def _handle_control(
    websocket: WebSocket, session: LiveSession, text: str
) -> None:
    try:
        control = ControlMessage.model_validate_json(text)
    except Exception:  # noqa: BLE001
        return

    if control.type != "control":
        return

    if control.action == "reset":
        # Clears the in-progress movement but NEVER the repetition count -
        # repetitions already persisted must not be replayed.
        session.analyzer.reset_cycle()
    elif control.action == "pause":
        session.analyzer.reset_cycle()


async def _send(websocket: WebSocket, message: BaseModel) -> None:
    try:
        await websocket.send_text(message.model_dump_json())
    except (WebSocketDisconnect, RuntimeError):
        raise WebSocketDisconnect(code=1001)


async def _send_error(
    websocket: WebSocket, code: str, message: str, *, recoverable: bool
) -> None:
    try:
        await websocket.send_text(
            PoseErrorMessage(
                data=PoseErrorData(
                    code=code, message=message, recoverable=recoverable
                )
            ).model_dump_json()
        )
    except Exception:  # noqa: BLE001 - the socket may already be gone
        pass


def _iso(epoch_seconds: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).isoformat()


__all__ = ["router"]
