# Build Status

Last updated: **29 August 2026**

This file distinguishes **CREATED** (the code exists) from **VERIFIED** (it was
actually executed and observed to work on this machine). Nothing below is
marked VERIFIED unless the corresponding command was run and its output read.

| Status | Meaning |
| --- | --- |
| **VERIFIED** | Executed on this machine; output observed |
| **CREATED** | Written and type-checked, but not executed end-to-end |
| **BLOCKED** | Cannot be verified here; the reason is stated |
| **NOT STARTED** | Not yet built |

---

## Environment actually present on the build machine

| Tool | Version | Notes |
| --- | --- | --- |
| Node | 24.18.0 | |
| npm | 11.16.0 | |
| Python | 3.13.4 | Reachable as `py -3.13`; bare `python` is the Microsoft Store stub |
| PostgreSQL | **18.6 (local service)** | Windows service `postgresql-x64-18`, port 5432. Migrated off the embedded 17.5 cluster; `embedded-postgres` retained as a fallback on port 55432 |
| Docker | **absent** | Not installed - see BLOCKED items |
| Git | 2.55.0 | Repository initialised; no commit author configured |

---

## Phase 0 - Audit and migration preparation

| Item | Status | Evidence |
| --- | --- | --- |
| All four prototypes inspected | VERIFIED | Every custom source file read; see `docs/EXISTING_PROTOTYPE_MIGRATION.md` |
| Git repository initialised | VERIFIED | `git init`; 111 source files staged |
| `.gitignore` written | VERIFIED | Excludes `node_modules`, `.venv`, `.env`, `*.task`, `*.zip` |
| Legacy source archived | VERIFIED | 108 files in `legacy/`, 1.2 MB, no dependency directories |
| Archive integrity checked | VERIFIED | `diff` of file lists between source and archive, per prototype |
| Third-party attribution recorded | VERIFIED | `legacy/README.md` |
| **Baseline commit** | **BLOCKED** | No `user.name` / `user.email` configured. Global Git identity was deliberately not modified. See *Outstanding actions*. |
| Old top-level `backend/`, `frontend/`, `FYP/` removed | **NOT DONE** | Content is archived and staged, but deletion was declined by the environment's safety policy. Harmless - see *Outstanding actions*. |

---

## Phase 1 - Foundation

| Item | Status | Evidence |
| --- | --- | --- |
| npm workspace repository | VERIFIED | `npm install` completed; 598 packages |
| PostgreSQL running | VERIFIED | Local PostgreSQL 18.6 on port 5432, connecting as the non-superuser role `physio` |
| Migration off the embedded cluster | VERIFIED | 20 tables, 539 rows; schema fingerprint and per-table content hashes identical on both servers — see `docs/DATABASE_MIGRATION.md` |
| Prisma schema (19 models, 14 enums) | VERIFIED | `prisma migrate status` -> "Database schema is up to date!"; `prisma migrate diff` -> "No difference detected" |
| Initial migration | VERIFIED | `20260828034303_init` |
| Partial unique indexes (raw SQL) | VERIFIED | `20260828040000_partial_unique_indexes`; both indexes confirmed present via `pg_indexes` |
| NestJS boots | VERIFIED | `GET /api/v1/health` -> 200 |
| Database readiness probe | VERIFIED | `GET /api/v1/ready` -> `{"database":"up"}` |
| Swagger served | VERIFIED | `GET /api/docs` -> 200 |
| Environment validation fails fast | VERIFIED | 10 unit tests in `env.validation.spec.ts` |
| Vite + React + TypeScript boots | VERIFIED | Dev server 200; production build succeeds |
| FastAPI pose service boots | VERIFIED | `GET /health`, `/ready`, `/model-info` all 200 |
| YOLOv8 weights downloaded and verified | VERIFIED | `yolov8n-pose.pt`, 6,832,633 bytes, SHA-256 recorded in `checksums.json` |

---

## Phase 2 - Application core

| Item | Status | Evidence |
| --- | --- | --- |
| Registration, login, `/auth/me` | VERIFIED | e2e suite + live browser |
| Argon2id password hashing | VERIFIED | 6 unit tests; `@node-rs/argon2` with a native Windows prebuild |
| Refresh-token rotation | VERIFIED | e2e: rotation succeeds, replay returns `REFRESH_TOKEN_REUSED` |
| Refresh-token reuse revokes the chain | VERIFIED | e2e asserts the successor token is also rejected |
| HttpOnly refresh cookie, path-scoped | VERIFIED | e2e inspects `Set-Cookie` |
| ADMIN self-registration blocked | VERIFIED | e2e + live check, both 400 |
| Role guards | VERIFIED | e2e: patient calling therapist routes -> 403 |
| Patient-to-patient isolation | VERIFIED | e2e + live: 403 `PATIENT_ACCESS_DENIED` |
| Therapist-to-unlinked-patient isolation | VERIFIED | e2e + live: 403 `THERAPIST_LINK_REQUIRED` |
| Invite-code patient linking | VERIFIED | e2e: single use enforced; only a SHA-256 hash stored |
| Exercise library + rule configs | VERIFIED | 5 exercises, ALL analysable - one per YOLOv8 analyzer in `analysis/` |
| Rehabilitation plans | VERIFIED | Created through the API in the live browser |
| Exercise assignments | VERIFIED | Created through the API; patient sees them |
| Patient archiving (discharge) | VERIFIED | 9 e2e tests + live run: link archived, access revoked (403), history retained, re-link restores the SAME row |
| Assignment removal (delete / archive) | VERIFIED | 7 e2e tests + live round trip: an assignment with 18 sessions archived and reopened, all 336 repetitions and 14 reports retained |
| Seed data | VERIFIED | 12 sessions, 312 repetitions, reports, feedback, notifications |
| Rate limiting | VERIFIED | Live: 5 registrations allowed, 6th onward -> 429 |

---

## Phase 3 - Pose engine

| Item | Status | Evidence |
| --- | --- | --- |
| YOLOv8n-pose (ultralytics) | VERIFIED | Model loads in ~3.4 s; 17 COCO keypoints, 2-D pixels. Replaced MediaPipe on 29 Aug 2026 - see `docs/YOLOV8_MIGRATION.md` |
| Landmark registry (named, not indexed) | VERIFIED | Unit tests |
| Joint-angle geometry | VERIFIED | 24 tests including NaN, zero-length and collapsed-vector cases |
| Angle smoothing (rolling median) | VERIFIED | Unit tests |
| Movement state machine | VERIFIED | 24 tests: hysteresis, dwell, cooldown, partial reps, occlusion |
| Repetition counting | VERIFIED | Jitter, half-reps and stray frames all correctly rejected |
| Resume from persisted rep count | VERIFIED | Analyzer seeded at 5 produces rep 6 next |
| Data-driven exercise analyzers | VERIFIED | 24 tests on synthetic skeletons of exact known geometry |
| Visibility gating | VERIFIED | Hidden ankles -> `PARTIAL_BODY_VISIBLE`, zero repetitions counted |
| Error-code catalogue | VERIFIED | Unit tests + live payloads |
| `POST /analyze` debug endpoint | CREATED | Route registered and type-checked; exercised indirectly via the WebSocket path |
| Pose ticket verification | VERIFIED | Invalid ticket rejected at handshake |
| Backend internal client | VERIFIED | Live: analyzer-context fetched, session activated |

**Pose service test suite: 102 passed.**

---

## Phase 4 - End-to-end session (the milestone)

| Item | Status | Evidence |
| --- | --- | --- |
| Session create (CREATED) | VERIFIED | e2e + live browser |
| One-live-session rule | VERIFIED | Second concurrent start -> 409 |
| Cross-patient session hijack blocked | VERIFIED | 403 `RESOURCE_NOT_OWNED` |
| Pose ticket issuance | VERIFIED | Short-lived (<= 5 min asserted) |
| Browser camera capture | VERIFIED (denial path) | Permission-denied path renders the correct message and retry. **Successful capture not verified** - the automation browser blocks camera access. See BLOCKED. |
| Frame sampler | CREATED | Cannot run without a real camera; the transport it feeds is verified |
| Pose WebSocket, browser side | CREATED | Hook written and type-checked |
| Pose WebSocket, server side | VERIFIED | 12 real JPEG frames streamed; 12 `pose:update` responses |
| Real pose detection through the socket | VERIFIED | Person detected; genuine joint angles returned |
| Session activation (CREATED -> ACTIVE) | VERIFIED | Driven by the pose service over the internal channel |
| Repetition ingestion | VERIFIED | 12 repetitions persisted |
| Ingest idempotency | VERIFIED | Replay returns `duplicate: true`; row count stays 1 |
| Rep rejected after completion | VERIFIED | 409 `SESSION_NOT_ACTIVE` |
| Session completion | VERIFIED | Totals computed server-side from stored repetitions |
| Completion idempotency | VERIFIED | Second call returns the same report; exactly 1 report row |
| Report generation | VERIFIED | Angle statistics and common errors aggregated |
| Patient report view | VERIFIED | Rendered in a real browser |
| Therapist report view | VERIFIED | Linked therapist 200; unrelated patient 403 |
| Progress aggregation | VERIFIED | Timeline, per-exercise breakdown, recurring issues |

### The milestone chain

Every link below was executed and observed:

```
login -> assigned exercise -> start session -> pose ticket
  -> FastAPI WebSocket -> MediaPipe -> landmarks -> joint angles
  -> repetition persisted -> PostgreSQL -> complete
  -> report -> patient view -> therapist view
```

The one segment **not** verified with a live webcam is the browser's own frame
capture, because the automation environment blocks `getUserMedia`. Everything
downstream of it - the identical WebSocket, the identical analyzer, the
identical persistence - was verified by streaming real image frames through the
real socket.

---

## Phase 5 - Feature breadth

| Item | Status | Evidence |
| --- | --- | --- |
| Bicep curl analyzer config | VERIFIED | Seeded, `analysisAvailable: true`, assignable |
| Shoulder raise analyzer config | VERIFIED | Seeded; `INCREASING` direction covered by unit tests |
| Progress charts | VERIFIED | Rendered with seeded data |
| Notifications | VERIFIED | Created by assignment/plan/feedback flows; read + mark-read work |
| Therapist dashboard | VERIFIED | Live browser |
| Patient dashboard | VERIFIED | Live browser |
| Therapist feedback | CREATED | Seeded and displayed; no authoring UI yet |
| Clinical assessments | CREATED | Schema + seed data; no authoring UI yet |
| Scheduled stale-session sweep | CREATED | Cron job registered; not observed firing |
| Frontend tests | VERIFIED | 28 passed |

---

## Phase 6 - Advanced and delivery

| Item | Status | Evidence |
| --- | --- | --- |
| Latency benchmarking | VERIFIED | Measured on real frames - see below |
| `GET /benchmark` endpoint | VERIFIED | Returns measured statistics |
| Documentation | VERIFIED | This file and the nine documents beside it |
| Dockerfiles (3) | **CREATED** | Written; **not built** - Docker is not installed |
| `docker-compose.yml` | **CREATED** | YAML validated; every service has a healthcheck. **Never run.** |
| scikit-learn trend module | **NOT STARTED** | Stretch. See `docs/NEXT_STEPS.md` |
| Recorded-clip replay mode | **NOT STARTED** | Stretch |
| Real-time chat | **NOT STARTED** | Stretch, explicitly deprioritised |

### Measured latency

Twelve real JPEG frames of a person, streamed through the production WebSocket:

| Stage | Mean | Max |
| --- | --- | --- |
| MediaPipe inference | **64.9 ms** | 81.5 ms |
| End-to-end (decode + inference + analysis) | **76.9 ms** | 138.1 ms |

Machine: Windows 10, CPU inference via the TensorFlow Lite XNNPACK delegate,
`pose_landmarker_full` model.

**Interpretation.** ~65 ms per frame puts the practical ceiling near 15 fps on
this hardware. The configured sample rate of **10 fps (100 ms per frame)**
therefore has roughly 23 ms of headroom. An earlier measurement of ~30 ms was
taken on a *blank* frame, where no landmarks are found and the model exits
early - it is not representative and is not quoted anywhere as a result.

No accuracy figure is claimed anywhere in this project. Detection accuracy
would require a labelled evaluation set; see `docs/NEXT_STEPS.md`.

---

## Test totals

| Suite | Count | Status |
| --- | --- | --- |
| Backend unit (Jest) | 60 | VERIFIED passing |
| Backend e2e (Jest + Supertest + real PostgreSQL) | 81 | VERIFIED passing |
| Pose service (pytest) | 102 | VERIFIED passing |
| Frontend (Vitest + Testing Library) | 74 | VERIFIED passing |
| Live API verification (`tools/verify/verify_api.py`) | 53 checks | VERIFIED passing |
| Live pose socket (`tools/verify/verify_pose_socket.py`) | 19 checks | VERIFIED passing |
| **Total** | **389** | **All passing** |

The Movera phase added 49 of these: 14 email-template tests, 21 e2e tests
covering verification, password reset, cross-role email uniqueness and the
password policy, and 14 frontend tests for the visibility toggle. See
`docs/MOVERA_UPDATE.md`.

### Email delivery

| Item | Status | Evidence |
| --- | --- | --- |
| SMTP transport (Gmail) | VERIFIED | `transporter.verify()` completed the STARTTLS and AUTH exchange against smtp.gmail.com:587 |
| Verification email delivered | VERIFIED | Live registration -> `verificationEmailSent: true`; accepted by Gmail |
| Password reset email delivered | VERIFIED | Live forgot-password -> accepted by Gmail |
| Patient-connected email | VERIFIED | Real invite redeemed between two live accounts |
| Therapist-connected email | VERIFIED | Same linking event; both parties emailed |
| Exercise-assigned email | VERIFIED | Real assignment created through `POST /assignments` |

All five email templates have been delivered by Gmail. No template remains
untested end to end.


The pose-service count rose from 72 to 83 with the single-limb aggregation
regression suite (`tests/test_single_limb.py`).

---

## BLOCKED items, and why

### Docker - not installed

`docker` is not on this machine, so the three Dockerfiles and
`docker-compose.yml` are **written but never built or run**. They are marked
CREATED, not VERIFIED, and `docker-compose.yml` carries a comment saying so.

The compose file was validated as YAML and checked to ensure every service
declares a healthcheck, but that is a syntax check, not a working stack.

*Mitigation:* the native workflow in `docs/SETUP.md` is fully verified and does
not need Docker. `apps/backend/scripts/dev-db.js` supplies a genuine PostgreSQL
server from `node_modules`, so no system database install is required either.

### Live webcam capture - blocked by the automation environment

The browser used for verification blocks `getUserMedia`, so a real camera was
never opened. The permission-denied path **was** verified end-to-end and
renders correctly.

*Mitigation:* the entire downstream path was verified by streaming real image
frames through the production WebSocket, so only the browser's capture call
itself is unverified. Any developer with a webcam can confirm it in one run;
the procedure is in `docs/TESTING.md`.

### Baseline Git commit - no author configured

`git init` succeeded and all source is staged, but `user.name` and
`user.email` are unset. Configuring them would mean inventing an author, so the
commit was deliberately left for the repository owner.

---

## Outstanding actions for the repository owner

Two things need a human decision. Neither blocks the application from running.

**1. Make the baseline commit.** Set your identity locally, then commit:

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
git commit -m "chore: consolidate prototypes into the physio-ai-platform monorepo"
```

**2. Remove the superseded top-level directories.** `backend/`, `frontend/` and
`FYP/` are fully archived under `legacy/` (verified by file-list comparison) and
staged in Git. Nothing in `apps/` or `services/` references them. Delete them
once you are satisfied:

```bash
git rm -r --cached backend frontend FYP && rm -rf backend frontend FYP
```

Keeping them costs about 2.9 GB, most of it Torch inside the old virtual
environment and `node_modules`.
