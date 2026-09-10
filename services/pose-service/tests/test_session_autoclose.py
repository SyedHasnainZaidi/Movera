"""The session ends itself: verified through the real WebSocket.

The complaint this exists for is that a session kept running after the patient
had finished everything prescribed, and they had to notice and stop it
themselves. The fix has to hold at the level the browser actually sees, so
these tests drive the genuine `/ws/session` endpoint and read the genuine wire
messages.

What is faked is only the two things that make a test non-deterministic:

  * the DETECTOR, so a fixed sequence of poses can be fed in rather than
    depending on a photograph of a correctly-aligned human, and
  * the BACKEND, so no database is required.

Everything between them - the analyzer, the hold tracker, the goal test, the
close message - is the production code path.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import jwt

from app.api.websocket_session import router as ws_router
from app.landmarks.registry import PoseFrame
from app.pose.detector import DetectorPool
from app.services.backend_client import AnalyzerContext
from app.state.session_store import SessionStore

from tests.test_analyzer import SQUAT_RULES, build_squat_pose
from tests.test_hold import POSTURE_RULES, build_posture_pose

SECRET = "test-secret-that-is-long-enough-for-hs256-signing"
SESSION_ID = "sess-autoclose"
PATIENT_ID = "patient-1"

# A tiny valid JPEG. Never decoded - the fake detector ignores the frame - but
# it has to survive decode_frame, which is real.
import cv2  # noqa: E402
import numpy as np  # noqa: E402

_ok, _buf = cv2.imencode(".jpg", np.full((64, 64, 3), 200, np.uint8))
JPEG = _buf.tobytes()


class ScriptedDetector:
    """Returns a prepared pose per frame, in order, then repeats the last."""

    def __init__(self, poses: list[Optional[PoseFrame]]) -> None:
        self._poses = poses
        self.calls = 0

    def detect(self, _frame) -> tuple[list[PoseFrame], int, float]:
        pose = self._poses[min(self.calls, len(self._poses) - 1)]
        self.calls += 1
        return ([pose], 1, 1.0) if pose is not None else ([], 0, 1.0)


class ScriptedPool(DetectorPool):
    def __init__(self, detector: ScriptedDetector) -> None:  # noqa: D107
        self._detector = detector

    def acquire(self):  # type: ignore[override]
        return self._detector

    def release(self, detector) -> None:  # type: ignore[override]
        pass


@dataclass
class FakeBackend:
    """Records what the pose service told the backend."""

    context: AnalyzerContext
    activated: bool = False
    reps: list[dict[str, Any]] = None  # type: ignore[assignment]
    holds: list[dict[str, Any]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self.reps = []
        self.holds = []

    async def fetch_analyzer_context(self, session_id: str) -> AnalyzerContext:
        return self.context

    async def activate_session(self, session_id: str) -> None:
        self.activated = True

    async def ingest_rep(self, session_id: str, payload: dict) -> bool:
        self.reps.append(payload)
        return True

    async def ingest_hold_progress(self, session_id: str, payload: dict) -> bool:
        self.holds.append(payload)
        return True


def hold_context(target_hold_sec: float) -> AnalyzerContext:
    rules = {k: v for k, v in POSTURE_RULES.items()
             if k not in ("exerciseSlug", "ruleConfigVersion", "goalType",
                          "targetHoldSeconds")}
    return AnalyzerContext(
        session_id=SESSION_ID,
        session_status="CREATED",
        exercise_slug="static-posture",
        exercise_name="Postural Correction",
        rule_config_version=3,
        rule_config=rules,
        target_sets=1,
        reps_per_set=1,
        target_total_reps=1,
        current_persisted_rep_count=0,
        framing_instructions="Stand square to the camera.",
        recommended_view="FRONT",
        goal_type="HOLD",
        target_hold_sec=target_hold_sec,
        current_held_seconds=0.0,
    )


def build_client(poses: list[Optional[PoseFrame]], context: AnalyzerContext):
    detector = ScriptedDetector(poses)
    app = FastAPI()
    app.include_router(ws_router)
    app.state.session_store = SessionStore(
        ScriptedPool(detector),
        max_sessions=4,
        idle_ttl_seconds=900,
        max_session_minutes=120,
    )
    backend = FakeBackend(context=context)
    app.state.backend_client = backend
    return TestClient(app), backend


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    """Point the endpoint's settings at this test's secret.

    The cache is cleared on BOTH sides: before, so the patched environment is
    read, and after, so a later test does not inherit this secret.
    """
    from app.core import config as config_module

    monkeypatch.setenv("POSE_TICKET_SECRET", SECRET)
    monkeypatch.setenv("POSE_SERVICE_TOKEN", SECRET)
    config_module.get_settings.cache_clear()
    yield
    config_module.get_settings.cache_clear()


def ticket() -> str:
    """A ticket of the shape the BACKEND mints - signed here for the test."""
    import time

    return jwt.encode(
        {
            "sub": "user-1",
            "sessionId": SESSION_ID,
            "patientProfileId": PATIENT_ID,
            "scope": "pose-session",
            "jti": "test-jti",
            "exp": int(time.time()) + 120,
        },
        SECRET,
        algorithm="HS256",
    )


def drain(ws, limit: int = 40) -> list[dict]:
    """Send one frame and collect everything the server says about it."""
    ws.send_bytes(JPEG)
    messages = []
    for _ in range(limit):
        message = json.loads(ws.receive_text())
        messages.append(message)
        # pose:update is sent last for a frame unless a rep or close follows,
        # so stop once the frame has clearly been answered.
        if message["type"] in ("pose:update",):
            # A rep:completed or session:closed may still follow immediately.
            break
    return messages


class TestHoldSessionClosesItself:
    def test_announces_the_goal_and_says_it_was_a_hold(self) -> None:
        aligned = build_posture_pose()
        # A tiny target so a handful of frames reaches it. Real frames arrive
        # ~140 ms apart; the tracker credits wall-clock time between them.
        client, backend = build_client([aligned], hold_context(0.05))

        with client.websocket_connect(f"/ws/session?ticket={ticket()}") as ws:
            ready = json.loads(ws.receive_text())
            assert ready["type"] == "session:ready"
            assert ready["data"]["goalType"] == "HOLD"
            assert ready["data"]["targetHoldSeconds"] == 0.05

            closed = None
            for _ in range(40):
                for message in drain(ws):
                    if message["type"] == "session:closed":
                        closed = message["data"]
                if closed:
                    break
                # Nudge wall-clock time forward between frames.
                import time as _time
                _time.sleep(0.02)

        assert closed is not None, "the session never closed itself"
        assert closed["reason"] == "GOAL_REACHED"
        assert closed["goalType"] == "HOLD"
        assert closed["heldSeconds"] >= 0.05
        assert closed["totalReps"] == 0

    def test_never_emits_a_repetition(self) -> None:
        aligned = build_posture_pose()
        client, backend = build_client([aligned], hold_context(0.05))

        seen = []
        with client.websocket_connect(f"/ws/session?ticket={ticket()}") as ws:
            json.loads(ws.receive_text())  # session:ready
            for _ in range(20):
                for message in drain(ws):
                    seen.append(message["type"])
                import time as _time
                _time.sleep(0.02)

        assert "rep:completed" not in seen
        assert backend.reps == []

    def test_posts_a_final_snapshot_before_closing(self) -> None:
        """The report is built from the snapshot, so the last one must land.

        Without the forced flush the report would be built from whatever the
        last periodic post happened to contain - up to five seconds stale, and
        missing the hold that actually completed the session.
        """
        aligned = build_posture_pose()
        client, backend = build_client([aligned], hold_context(0.05))

        with client.websocket_connect(f"/ws/session?ticket={ticket()}") as ws:
            json.loads(ws.receive_text())
            closed = False
            for _ in range(40):
                for message in drain(ws):
                    if message["type"] == "session:closed":
                        closed = True
                if closed:
                    break
                import time as _time
                _time.sleep(0.02)

        assert backend.holds, "no hold snapshot was ever posted"
        final = backend.holds[-1]
        assert final["heldSec"] >= 0.05
        assert final["analysedFrames"] > 0

    def test_a_misaligned_patient_is_not_closed(self) -> None:
        """Guidance, not a stopwatch: bad posture must never finish a session."""
        slouched = build_posture_pose(spine_deg=140.0)
        client, _ = build_client([slouched], hold_context(0.05))

        types = []
        with client.websocket_connect(f"/ws/session?ticket={ticket()}") as ws:
            json.loads(ws.receive_text())
            for _ in range(25):
                for message in drain(ws):
                    types.append(message["type"])
                import time as _time
                _time.sleep(0.02)

        assert "session:closed" not in types

    def test_the_frame_payload_carries_hold_progress(self) -> None:
        aligned = build_posture_pose()
        client, _ = build_client([aligned], hold_context(60.0))

        with client.websocket_connect(f"/ws/session?ticket={ticket()}") as ws:
            json.loads(ws.receive_text())
            drain(ws)
            update = [m for m in drain(ws) if m["type"] == "pose:update"][0]

        data = update["data"]
        assert data["goalType"] == "HOLD"
        assert data["hold"] is not None
        assert data["hold"]["targetSeconds"] == 60.0
        assert data["rep"]["count"] == 0


def squat_context(target_total_reps: int) -> AnalyzerContext:
    rules = {
        k: v
        for k, v in SQUAT_RULES.items()
        if k not in ("exerciseSlug", "ruleConfigVersion")
    }
    return AnalyzerContext(
        session_id=SESSION_ID,
        session_status="CREATED",
        exercise_slug="squat",
        exercise_name="Bodyweight Squat",
        rule_config_version=4,
        rule_config=rules,
        target_sets=1,
        reps_per_set=target_total_reps,
        target_total_reps=target_total_reps,
        current_persisted_rep_count=0,
        framing_instructions="Stand back.",
        recommended_view="FRONT",
    )


def one_squat() -> list[PoseFrame]:
    """Poses for a full rest -> peak -> rest cycle.

    Repeated angles satisfy the state machine's minimum-dwell requirement, and
    there are enough frames that the movement takes longer than
    minRepDurationMs once the socket round-trips are counted.
    """
    standing = [build_squat_pose(170.0)] * 4
    descending = [build_squat_pose(140.0)] * 3
    bottom = [build_squat_pose(95.0)] * 4
    ascending = [build_squat_pose(140.0)] * 3
    return standing + descending + bottom + ascending + standing


class TestRepetitionSessionClosesItself:
    """The original complaint: all repetitions done, session still running."""

    def test_closes_once_the_last_repetition_lands(self) -> None:
        client, backend = build_client(one_squat(), squat_context(1))

        closed = None
        reps = 0
        with client.websocket_connect(f"/ws/session?ticket={ticket()}") as ws:
            ready = json.loads(ws.receive_text())
            assert ready["data"]["goalType"] == "REPS"

            for _ in range(40):
                ws.send_bytes(JPEG)
                for _ in range(3):
                    message = json.loads(ws.receive_text())
                    if message["type"] == "rep:completed":
                        reps += 1
                        continue
                    if message["type"] == "session:closed":
                        closed = message["data"]
                        break
                    if message["type"] == "pose:update":
                        break
                if closed:
                    break
                # 60 ms per frame: the rep must last longer than
                # minRepDurationMs (400 ms) or the state machine discards it as
                # faster than a human can move.
                import time as _time
                _time.sleep(0.06)

        assert reps == 1
        assert closed is not None, "the session never closed itself"
        assert closed["reason"] == "GOAL_REACHED"
        assert closed["goalType"] == "REPS"
        assert closed["totalReps"] == 1
        assert closed["targetTotalReps"] == 1

    def test_does_not_close_before_the_prescription_is_met(self) -> None:
        # Same single squat, but two were prescribed.
        client, _ = build_client(one_squat(), squat_context(2))

        types: list[str] = []
        with client.websocket_connect(f"/ws/session?ticket={ticket()}") as ws:
            json.loads(ws.receive_text())
            for _ in range(30):
                ws.send_bytes(JPEG)
                for _ in range(3):
                    message = json.loads(ws.receive_text())
                    types.append(message["type"])
                    if message["type"] == "pose:update":
                        break
                import time as _time
                _time.sleep(0.06)

        assert "rep:completed" in types
        assert "session:closed" not in types
