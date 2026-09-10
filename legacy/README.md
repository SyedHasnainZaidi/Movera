# Legacy Prototypes — Archive & Attribution

This directory preserves the earlier prototypes that preceded the current
**AI-Powered Intelligent Physiotherapy Assessment and Rehabilitation Monitoring System**.

**Nothing in the production application (`apps/`, `services/`) imports, links to, or depends on
any file in this directory.** These are kept for academic transparency, to document the
evolution of the project, and to make the migration auditable.

Only **source code, configuration and documentation** were archived. Disposable generated
directories (`venv/`, `node_modules/`, `__pycache__/`, `build/`, `*.zip`, `physio.db`) were
deliberately **not** preserved — they are reproducible from the manifests that were kept.

---

## 1. `unity-hand-prototype/` — OpenCV + cvzone + MediaPipe hand tracking → Unity

### ⚠️ Third-party origin — this is NOT entirely original team work

This prototype was **derived from a publicly published third-party project**. This must be
stated in the FYP report. Presenting it as fully original work would be misconduct.

**What can be determined with confidence from the archived files:**

| Evidence | Finding |
| --- | --- |
| Directory name `OpenCV-Unity-To-Build-3DHands-main` | Matches GitHub's ZIP-download naming convention `<repo>-<branch>`, i.e. a repository named **`OpenCV-Unity-To-Build-3DHands`**, default branch `main` |
| `UPSTREAM_README.md` | Is the upstream author's own README, retained verbatim — including their demo links, tutorial prose and Chinese-language annotations |
| Author links inside that README | CSDN profile `https://blog.csdn.net/weixin_50679163`, tutorial article `.../article/details/124658313`, and a Juejin 2022 hackathon entry |
| Base64 watermark in the README's embedded images (`text_Q1NETiBAQklHQk9TU3lpZmk=`) | Decodes to **`CSDN @BIGBOSSyifi`** — the upstream author's handle |

**What could NOT be determined:**

- **No `LICENSE` file was present** anywhere in the downloaded copy. The upstream licence terms
  are therefore **unknown**. This has not been guessed or invented.
- The exact upstream GitHub account name is not recorded in any archived file. Only the CSDN
  identity above is evidenced.

**Action required before final submission:** locate the upstream repository, record its exact
URL, author and licence, and cite it in the report's references. If the licence turns out to be
restrictive, the archive can be reduced to a citation only — the production system does not
depend on it.

### Files, and who wrote what

| File | Origin |
| --- | --- |
| `UPSTREAM_README.md` | **Upstream, verbatim.** Retained unmodified so authorship is unambiguous. |
| `UnityFile/UDPReceive.cs` | **Upstream, essentially verbatim** — appears character-for-character in the upstream README. |
| `UnityFile/LineCode.cs` | **Upstream, verbatim** — also reproduced in the upstream README. |
| `UnityFile/HandTracking.cs` | **Upstream base + team modifications.** Upstream supplied the 21-point UDP parsing loop. The team added the `DetectGesture()` method, the null/length guard (`points.Length < 63`), and `.Trim()` on parsing. |
| `PythonFile/HandsMain.py` | **Upstream base + team modifications.** Upstream supplied the capture → `HandDetector` → landmark-flatten → UDP-send loop. The team added the `fingersUp()` gesture ladder (Fist / Open Hand / Thumbs Up / Peace / Pointing), the `"landmarks\|gesture"` message format, the `cv2.CAP_DSHOW` backend with camera index `1`, the on-frame gesture overlay, and the cleanup block. |
| `PythonFile/camera_test.py` | **Team-written.** Short device-enumeration helper. |
| `Demo.py` | **Team-written.** Standalone `mediapipe.solutions.hands` finger counter; not wired into the rest of the prototype. |

### Why it was explored

It was the team's first working demonstration of the core idea: a webcam feed producing
real-time skeletal landmark data, with that data driving a live visualisation.

### Why it was superseded

1. **Wrong body region.** It tracks *hands* (21 landmarks). Physiotherapy assessment needs
   full-body pose (hips, knees, ankles, shoulders).
2. **Wrong delivery platform.** The final product is a web application. Unity and UDP cannot be
   used from a browser, and UDP gives no delivery guarantees, ordering or authentication.
3. **The API it uses no longer exists.** Both `HandsMain.py` (via `cvzone`) and `Demo.py` depend
   on `mediapipe.solutions.*`, which has been **removed** from current MediaPipe distributions —
   `mediapipe` 0.10.30, 0.10.35 and 1.0.1 all ship Tasks-only builds. This code cannot run on a
   modern install without pinning an obsolete MediaPipe version.
4. **Dead environment.** The bundled `venv/` referenced `C:\Users\User\AppData\...\Python310` — a
   different machine's user profile — and could not be activated. It was not archived.

### Concepts carried forward into `services/pose-service/`

- Real-time frame-processing loop structure.
- Landmark-coordinate extraction and normalisation handling.
- Detection-confidence configuration as a tunable parameter.
- **Discrete state classification from landmark geometry.** The gesture `if/elif` ladder is
  conceptually the direct ancestor of the exercise movement-state machines — the difference is
  that the rehabilitation version adds *memory of the previous state*, which is what makes
  repetition counting possible.
- Skeleton visualisation by connecting landmark pairs (Unity `LineRenderer` → HTML canvas).

---

## 2. `yolo-fastapi-prototype/` — FastAPI + YOLOv8-pose + SQLite

**Origin: team-written.** No third-party attribution issues identified.

### What it contained

A FastAPI service with JWT auth, SQLAlchemy/SQLite persistence, server-side OpenCV webcam
capture, YOLOv8 pose detection (COCO-17 keypoints), and five exercise analyzers
(squat, bicep curl, shoulder abduction, straight leg raise, static posture).

### Why it was superseded

1. **YOLO is excluded from the final architecture** by project requirement. It also pulled
   `torch`, `torchvision` and `ultralytics` — roughly 2.5 GB of dependencies — for a task
   MediaPipe performs with 33 landmarks (vs COCO's 17), per-landmark visibility, and metric
   world coordinates.
2. **Server-side camera.** `camera/camera_stream.py` called `cv2.VideoCapture(0)` *inside the API
   process*. In a deployed web application this analyses whoever stands in front of the **server**,
   not the remote patient. This is unfixable without moving the camera to the browser.
3. **Single-user by construction.** A module-level `session_manager` singleton held one analyzer
   and one rep counter for the whole process; two concurrent patients would share them.
4. **Polling-driven analysis.** `/pose-data`, `/joint-angles` and `/exercise-result` each grabbed a
   *new* frame, so the movement state machine only advanced when the client happened to poll, and
   two polls ran inference twice on different frames.
5. **Unbounded writes.** Every `/exercise-result` poll inserted a `JointData` row per angle.
6. **Unauthenticated CV routes.** Only `/select-exercise` and `/patient/history` required a token;
   the camera and all analysis endpoints were open. CORS was `allow_origins=["*"]` *with*
   `allow_credentials=True`.
7. **Duplicated the application backend.** Users, auth and sessions now belong to NestJS.

### Logic genuinely reused (ported, not rewritten)

This prototype contained the most valuable code in the whole workspace, and it was **kept**:

| Source | Ported to | Note |
| --- | --- | --- |
| `analysis/angle_calculation.py` → `calculate_angle()` | `app/geometry/angles.py` | Correct implementation: builds BA/BC vectors, guards zero-length, clips cosine to `[-1, 1]` before `arccos`. Extended to 3-D and given property-based tests. |
| `analysis/base.py` → `BaseExerciseAnalyzer` | `app/exercises/base.py` | Required-landmarks / reset / score-accumulation / uniform-result structure retained. |
| `analysis/squat.py`, `bicep_curl.py`, `shoulder_abduction.py` | `app/exercises/*.py` | Angle selection, state interpretation and posture rules retained; thresholds moved into `ExerciseRuleConfig`, state machines hardened with hysteresis, dwell time and cooldown. |
| Snake-case joint naming (`left_knee`, `right_shoulder`) | `app/landmarks/registry.py` | The analyzers addressed joints **by name, never by index** — a good original decision that made swapping the detector a one-adapter change rather than five rewrites. |
| Threshold values | Seeded `ExerciseRuleConfig` rows | Retained as starting values, explicitly labelled `PROTOTYPE_DEFAULT_REQUIRES_PHYSIOTHERAPIST_REVIEW`. |

The `ml/` package was **not** ported: all three classes returned
`{"status": "model_not_implemented"}` and contained no model.

---

## 3. `express-mongo-prototype/` — Express + MongoDB REST API

**Origin: team-written.**

### Why it was superseded

- Target stack is **NestJS + PostgreSQL + Prisma**; the domain is relational throughout
  (patients ↔ therapists ↔ plans ↔ assignments ↔ sessions ↔ repetitions).
- `config/db.js` silently fell back to `mongodb-memory-server` when no MongoDB was reachable, so
  the application appeared to work while **discarding all data on every restart**.
- Security defects that are fixed structurally in the new backend rather than patched here:
  - `POST /api/auth/signup` passed `role` straight from the request body into `User.create()`,
    and the schema enum accepted `'admin'` — **public privilege escalation**.
  - `getPatientDetail`, `getPatientReports` and `assignExercise` never verified that the patient
    belonged to the requesting therapist — **any therapist could read or write any patient**.
  - `addPatient` re-assigned an existing user's `therapistId` given only their email address.
  - New patient accounts were created with a shared literal default password.
  - The error middleware returned stack traces whenever `NODE_ENV !== 'production'`.
  - `JWT_SECRET` had a hard-coded fallback string in two files.
  - Access tokens lasted 30 days with no refresh, rotation or revocation.
  - `getTherapistAnalytics` returned a hard-coded `activeComplianceRate: 88`.

### Reused as specification

The controllers were treated as an **executable specification** for the NestJS services — the
dashboard and progress-timeline aggregation shapes were already worked out and already matched
what the React pages consumed. The Mongoose models informed the first draft of the Prisma
schema, and `utils/seed.js` informed the Prisma seed scenario.

---

## 4. `cra-react-prototype/` — Create React App frontend

**Origin: team-written.**

### Why it was superseded

- `react-scripts` (CRA) is no longer maintained; the target stack is **Vite + TypeScript**.
- The codebase is JavaScript with inline style objects, so no compile-time checking existed
  against the API contract.
- `ExerciseSession.jsx` ran MediaPipe Pose **in the browser** and computed its own reps. That
  design makes the client authoritative over clinical numbers, and it removes the Python
  computer-vision service that is the technical core of this project. Specifically:
  - `finishSession()` posted a **hard-coded `accuracy: 80`** to the backend.
  - `getAngle()` operated on *normalised* landmark coordinates, where `x` is divided by frame
    width and `y` by frame height — so a 4:3 frame skews every angle it produces.
  - Rep counting used a single boolean (`positionRef`) initialised to `'up'`, watched only the
    left leg (landmarks 23/25/27), and applied no visibility gating, hysteresis or debounce.
  - The MediaPipe WASM runtime was fetched from the jsDelivr CDN at runtime, so the app could
    not run offline or in a sealed demo environment.
  - Cleanup called `camera.stop()` (the MediaPipe helper) but never stopped the underlying
    `MediaStreamTrack`s, leaving the webcam active after leaving the page.

### Reused as specification

The page inventory and route structure were kept as the **information architecture** of the new
frontend — the same screens for both roles, rewritten in TypeScript. The canvas skeleton-overlay
drawing (landmark connection pairs and draw loop) was ported as **rendering only**; all analysis
was removed from the browser.

---

## Summary of the migration

| Prototype | Verdict | Production successor |
| --- | --- | --- |
| `unity-hand-prototype` | Archived — concepts carried forward | `services/pose-service/` |
| `yolo-fastapi-prototype` | **Logic harvested**, infrastructure discarded | `services/pose-service/` |
| `express-mongo-prototype` | Behavioural specification | `apps/backend/` |
| `cra-react-prototype` | IA + overlay rendering reused | `apps/frontend/` |

See `docs/EXISTING_PROTOTYPE_MIGRATION.md` for the file-by-file migration record.
