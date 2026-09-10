# Live verification scripts

Black-box checks that drive the **running** system over HTTP and WebSocket,
exactly as a browser would. They complement the automated suites rather than
replacing them:

| Suite | Scope | Command |
| --- | --- | --- |
| `apps/backend` Jest unit | pure logic, no I/O | `npm run backend:test` |
| `apps/backend` Jest e2e | real database, real HTTP | `npm run backend:test:e2e` |
| `services/pose-service` pytest | geometry, state machine, analyzers | `pytest` |
| `apps/frontend` Vitest | components, guards | `npm run frontend:test` |
| **these scripts** | the three services running together | see below |

## verify_api.py

Drives the whole clinical workflow through the public API plus the internal
pose-service channel: registration, secure patient linking, prescription,
session lifecycle, repetition ingestion, idempotency, completion, reporting,
and every authorization boundary between them.

```bash
py -3.13 tools/verify/verify_api.py
```

Requires the database and backend to be running.

## verify_pose_socket.py

Opens the real pose WebSocket with a real ticket and streams a real photograph
through MediaPipe, then asserts on genuine detector output - landmarks, joint
angles, movement state, measured latency - and confirms the session transitions
CREATED -> ACTIVE through the internal channel.

```bash
services/pose-service/.venv/Scripts/python tools/verify/verify_pose_socket.py
```

Requires the database, backend and pose service to be running.

### Test fixture

`pose_fixture.jpg` is Google's own MediaPipe sample image
(`storage.googleapis.com/mediapipe-assets/pose.jpg`), used here purely as a
detector input. No patient imagery is stored in this repository, and the
application never persists a video frame.
