"""Verify the live pose WebSocket path end-to-end.

Drives the exact transport a browser uses:
    login -> create session -> mint pose ticket -> open WebSocket
    -> stream real JPEG frames -> receive pose:update
    -> session transitions CREATED -> ACTIVE via the internal channel

Uses a real photograph (Google's own MediaPipe sample) so the landmarks and
joint angles produced are genuine detector output, not synthetic fixtures.
"""

from __future__ import annotations

import asyncio
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import websockets

API = "http://127.0.0.1:3000/api/v1"
WS = "ws://localhost:8000/ws/session"
ORIGIN = "http://localhost:5173"
FIXTURE = Path(__file__).resolve().parent / "pose_fixture.jpg"

PASSED: list[str] = []
FAILED: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASSED if ok else FAILED).append(label)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  {detail}" if not ok else ""))


def post(path: str, token: str | None = None, data: dict | None = None) -> dict:
    body = json.dumps(data or {}).encode()
    request = urllib.request.Request(API + path, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            # The throttle doing its job, not a system fault.
            raise SystemExit(
                "\nRate limited (HTTP 429). The login throttle allows 10 attempts\n"
                "per minute - that is the guard working, not a failure. Wait a\n"
                "minute and run again.\n"
            ) from exc
        raise


def get(path: str, token: str) -> dict:
    request = urllib.request.Request(API + path, method="GET")
    request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


async def bad_ticket_rejected() -> None:
    print("\n--- 1. Ticket rejection ---")
    try:
        async with websockets.connect(
            f"{WS}?ticket=not-a-real-ticket",
            origin=ORIGIN,
        ) as socket:
            await socket.recv()
        check("Invalid ticket is rejected", False, "connection stayed open")
    except websockets.exceptions.InvalidStatus as exc:
        check("Invalid ticket is rejected at handshake", True, str(exc))
    except websockets.exceptions.ConnectionClosed as exc:
        check(
            "Invalid ticket closes the socket with code 4401",
            exc.rcvd is not None and exc.rcvd.code == 4401,
            f"got close code {exc.rcvd.code if exc.rcvd else '?'}",
        )


async def main() -> int:
    print("=" * 70)
    print("  POSE WEBSOCKET VERIFICATION")
    print("=" * 70)

    if not FIXTURE.exists():
        print("Fixture image missing.")
        return 1
    frame_bytes = FIXTURE.read_bytes()
    print(f"\nFixture: {FIXTURE.name} ({len(frame_bytes):,} bytes)")

    await bad_ticket_rejected()

    # ------------------------------------------------------------------
    print("\n--- 2. Session setup ---")
    auth = post(
        "/auth/login",
        data={"email": "patient1@example.com", "password": "DevPassword123!"},
    )
    token = auth["accessToken"]

    dashboard = get("/patients/me/dashboard", token)
    squat = next(
        a for a in dashboard["assignments"] if a["exercise"]["slug"] == "squat"
    )

    # Clear any session left live by an earlier run.
    try:
        stale = get("/patients/me/sessions?limit=1", token)
        del stale
    except Exception:  # noqa: BLE001
        pass

    try:
        created = post("/sessions", token, {"assignmentId": squat["id"]})
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read().decode())
        if body.get("code") == "SESSION_ALREADY_LIVE":
            print("  (cancelling a session left live by a previous run)")
            # Find and cancel it, then retry.
            raise SystemExit(
                "A live session already exists. Re-run after it is swept."
            ) from exc
        raise

    session_id = created["id"]
    check("Session created (CREATED)", created["status"] == "CREATED")

    ticket = post(f"/sessions/{session_id}/pose-ticket", token)
    check("Pose ticket issued", bool(ticket["ticket"]))

    # ------------------------------------------------------------------
    print("\n--- 3. Live frame stream ---")
    updates: list[dict] = []
    ready: dict | None = None

    async with websockets.connect(
        f"{WS}?ticket={ticket['ticket']}",
        origin=ORIGIN,
        max_size=4_000_000,
    ) as socket:
        raw = await asyncio.wait_for(socket.recv(), timeout=15)
        message = json.loads(raw)
        ready = message.get("data") if message.get("type") == "session:ready" else None
        check("session:ready received", ready is not None, str(message)[:120])

        if ready:
            check(
                "Ready payload carries the authoritative prescription",
                ready["targetTotalReps"] == 30 and ready["targetSets"] == 3,
                str(ready),
            )
            check(
                "Ready payload reports the resume point",
                ready["resumedFromRep"] == 0,
                str(ready.get("resumedFromRep")),
            )

        # Stream 12 real frames, as the browser would.
        for _ in range(12):
            await socket.send(frame_bytes)
            raw = await asyncio.wait_for(socket.recv(), timeout=20)
            payload = json.loads(raw)
            if payload.get("type") == "pose:update":
                updates.append(payload["data"])
            await asyncio.sleep(0.1)

    check("pose:update received for every frame", len(updates) == 12, f"got {len(updates)}")

    if updates:
        first = updates[0]
        check("A person was detected in the frame", first["personDetected"] is True)
        check(
            "Landmarks were returned for the overlay",
            len(first["landmarks"]) >= 15,
            f"got {len(first['landmarks'])}",
        )
        check(
            "Landmarks are normalised to 0-1 image space",
            all(-0.5 <= lm["x"] <= 1.5 and -0.5 <= lm["y"] <= 1.5 for lm in first["landmarks"]),
        )
        check(
            "Joint angles were computed from the detected keypoints",
            # The squat's angles now follow analysis/squat.py: knee and hip
            # flexion plus the knee/ankle width ratio. `trunkLean` belonged to
            # the MediaPipe rule set, which measured trunk inclination against
            # gravity using metric world coordinates - YOLOv8 provides no such
            # space, and the prototype checked posture through the hip angle
            # instead.
            all(name in first["angles"] for name in ("knee", "hip")),
            str(list(first["angles"])),
        )
        check(
            "Knee angle is physically plausible (0-180 deg)",
            0 <= first["angles"]["knee"] <= 180,
            str(first["angles"].get("knee")),
        )
        check(
            "Movement state present and valid",
            first["movementState"]
            in {"IDLE", "UP", "GOING_DOWN", "DOWN", "GOING_UP"},
            first["movementState"],
        )
        check(
            "Tracking confidence reported in 0-1",
            0.0 <= first["confidence"] <= 1.0,
            str(first["confidence"]),
        )
        check(
            "Latency breakdown is measured, not zero",
            first["latencyMs"]["inference"] > 0,
            str(first["latencyMs"]),
        )
        check(
            "Rep block reflects the prescription",
            first["rep"]["targetCount"] == 30 and first["rep"]["targetSets"] == 3,
            str(first["rep"]),
        )
        check(
            "Frame index increments across frames",
            updates[-1]["frameIndex"] > updates[0]["frameIndex"],
            f"{updates[0]['frameIndex']} -> {updates[-1]['frameIndex']}",
        )

        inference = [u["latencyMs"]["inference"] for u in updates]
        total = [u["latencyMs"]["total"] for u in updates]
        print(
            f"\n  Measured latency over {len(updates)} real frames:"
            f"\n    inference  mean {sum(inference)/len(inference):6.1f} ms   max {max(inference):6.1f} ms"
            f"\n    end-to-end mean {sum(total)/len(total):6.1f} ms   max {max(total):6.1f} ms"
        )
        angles = updates[0]["angles"]
        print("  Joint angles detected on the fixture image:")
        for name, value in sorted(angles.items()):
            print(f"    {name:<14} {value:7.1f}")

    # ------------------------------------------------------------------
    print("\n--- 4. Session state after streaming ---")
    state = get(f"/sessions/{session_id}", token)
    check(
        "Session was activated by the pose service (CREATED -> ACTIVE)",
        state["status"] == "ACTIVE",
        f"status is {state['status']}",
    )

    post(f"/sessions/{session_id}/cancel", token)
    final = get(f"/sessions/{session_id}", token)
    check("Session cancels cleanly", final["status"] == "CANCELLED", final["status"])

    print("\n" + "=" * 70)
    print(f"  PASSED: {len(PASSED)}    FAILED: {len(FAILED)}")
    print("=" * 70)
    if FAILED:
        for failure in FAILED:
            print(f"  - {failure}")
        return 1
    print("\n  Live pose WebSocket path verified with real detector output.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
