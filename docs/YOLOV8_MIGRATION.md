# MediaPipe → YOLOv8 migration

Record of replacing the MediaPipe pose detector with the YOLOv8 implementation
from the project's own prototype (`FYP/FYP/physio_backend/`).

- **Detector:** MediaPipe Tasks `PoseLandmarker` → **YOLOv8n-pose** (ultralytics 8.4.132)
- **Keypoints:** 33 landmarks, 3-D metric world coordinates → **17 COCO keypoints, 2-D pixels**
- **Exercises:** 3 analysable → **5**, one per analyzer in `analysis/`
- **MediaPipe:** removed entirely. No second backend.

## What was kept

Everything outside pose extraction is untouched: NestJS backend, PostgreSQL 18,
Prisma, the React frontend, authentication, email, the therapist/patient
workflow and the whole session pipeline (pose ticket → WebSocket → analyzer →
internal channel → rep persistence → report).

The hardened repetition counter was kept too, as agreed. The prototype's
`_update_rep_counter` flipped on a bare `prev_state → new_state` comparison:

```python
if self._prev_state == "open" and new_state == "curl":
    self._rep_phase = "curl"
elif self._prev_state == "curl" and new_state == "open":
    if getattr(self, "_rep_phase", None) == "curl":
        self.repetitions += 1
```

No hysteresis, no dwell requirement, no cooldown, no duration bounds — so pose
jitter around a threshold counts several repetitions for one movement.
`MovementMachine` provides all four. **The prototype's thresholds are used
exactly as written; only its transition logic was replaced.**

## Exercises and thresholds

Every value below is copied from the file named beside it.

| Exercise | Source | Rest | Peak | Direction |
| --- | --- | --- | --- | --- |
| Bicep Curl | `bicep_curl.py` | elbow > 150° | elbow < 60° | decreasing |
| Bodyweight Squat | `squat.py` | knee > 160° | knee ≤ 120° | decreasing |
| Shoulder Abduction | `shoulder_abduction.py` | shoulder < 30° | shoulder > 90° | increasing |
| Straight Leg Raise | `straight_leg_raise.py` | hip < 30° | hip > 45° | increasing |
| Postural Correction | `posture.py` | spine ≤ 150° | spine ≥ 170° | increasing |

Form rules, also carried over verbatim:

| Rule | Threshold | Source line |
| --- | --- | --- |
| `ELBOW_DRIFT` | elbow-to-shoulder x-gap > 40 px | `bicep_curl.py` |
| `INCOMPLETE_ROM` (curl) | elbow > 120° at peak | `bicep_curl.py` |
| `EXCESSIVE_DEPTH` | knee < 70° at peak | `squat.py` |
| `TRUNK_LEAN` | hip angle < 150° | `squat.py` |
| `KNEE_ALIGNMENT` | knee width / ankle width < 0.7 | `squat.py` |
| `INCOMPLETE_ROM` (abduction) | shoulder < 80° at peak | `shoulder_abduction.py` |
| `SHOULDER_HITCH` | shoulder y-gap > 20 px | `shoulder_abduction.py` |
| `TRUNK_COMPENSATION` | hip y-gap > 25 px | `shoulder_abduction.py` |
| `KNEE_FLEXED` | knee < 160° | `straight_leg_raise.py` |
| `SHOULDER_ALIGNMENT` | shoulder y-gap > 20 px | `posture.py` |
| `HIP_ALIGNMENT` | hip y-gap > 20 px | `posture.py` |
| `SPINE_ALIGNMENT` | spine < 165° (= \|180 − spine\| > 15) | `posture.py` |

### Three deliberate deviations

**1. Single-limb exercises use `min`/`max`, not `average`.** The prototype
averaged left and right for every exercise. That is right for a squat, where
both knees flex together, and wrong for anything done one limb at a time — an
arm curled to 50° beside one resting at 170° averages to 110°, which never
crosses the 60° threshold, so **no repetition can ever complete**. This is the
exact defect behind the "reps not counting" report. Bicep curl uses `min`;
shoulder abduction and straight leg raise use `max`. Thresholds unchanged.

**2. Pixel distances are rescaled.** `cv2.VideoCapture(0)` opens at 640×480, so
thresholds like `elbow_drift > 40` are distances in a 640-wide image. The
browser sends 480-wide frames, which would make every one of those rules fire
33% too easily. Distances are converted into a 640-wide reference frame before
comparison (`PIXEL_REFERENCE_WIDTH`), so the numbers keep their meaning.

**3. Posture is modelled as a correction cycle.** `PostureAnalyzer` counts no
repetitions at all — it scores each frame correct/incorrect. The session
pipeline is built around repetitions, so one rep is one relax→straighten cycle
(spine ≤ 150° → ≥ 170°). This is an interpretation, not something the prototype
did, and it is stated in the exercise instructions.

Two smaller notes: `shoulder-raise` was **renamed** to `shoulder-abduction`
keeping its row id, so its existing assignments and sessions survive. And
`select_primary_pose` picks the nearest person by torso area rather than the
prototype's `keypoints.xy[0]`, which was whoever YOLO listed first — detection
order, not "the patient".

## The cost: no depth

This is the part worth stating plainly in the report.

MediaPipe returned **world landmarks** — metres, origin at the hip midpoint. A
joint angle computed from those is scale-invariant and independent of camera
position. YOLOv8 pose returns **2-D pixel coordinates only**. Every angle is now
a projection into the image plane, so it depends on where the patient stands.

Concretely: a bicep curl performed side-on to the camera measures correctly; the
same curl performed facing the camera foreshortens the forearm and reads too
large. That is why each exercise now declares a camera view and the framing
instructions are specific about it. The prototype had the same limitation — it
is inherent to a 2-D detector, not a regression introduced here.

## Performance

YOLOv8n-pose is slower than MediaPipe on CPU. Measured on the 4-core
development machine, per frame, streaming a real photo through the production
WebSocket:

| Configuration | Mean inference |
| --- | --- |
| MediaPipe (previous) | 65 ms |
| YOLOv8, as first wired up | **563 ms** |
| YOLOv8, tuned | **142 ms** |

Two things caused the 4× gap, both found by measuring rather than guessing:

- **torch used 2 of 4 cores.** It defaults to about half the logical CPUs on
  Windows, and inference is the only thing this service does. Now set to the
  full core count.
- **ultralytics upscaled every frame to 640×640.** That is its default `imgsz`,
  so most of the work went into pixels invented by the upscale. Now pinned to
  480, matching the frames actually sent (640 → ~205 ms, 480 → ~135 ms,
  320 → ~90 ms).

142 ms is a ceiling of about 7 fps, so `VITE_POSE_FRAME_SAMPLE_FPS` was lowered
from 10 to 7. Sampling faster only fills the socket with frames that
backpressure then drops.

If it is still too slow on the demo machine, the honest lever is
`POSE_MODEL_PATH=app/pose/model/yolov8s-pose.pt` for accuracy or `imgsz=320`
for speed — `python scripts/download_model.py --variant s` fetches the larger
model.

## Licence

**ultralytics YOLOv8 is AGPL-3.0.** That is copyleft covering network use:
hosting this service obliges you to offer its source under the same terms.
MediaPipe was Apache-2.0, which carries no such obligation. Fine for an academic
project, and a real constraint on any commercial deployment — worth a sentence
in the report.

## Files

| Added | |
| --- | --- |
| `app/pose/detector.py` | YOLOv8 detector, ported from `yolo/pose_detector.py` |
| `prisma/apply-exercise-library.ts` | Non-destructive exercise updater |
| `tests/test_yolo_detector.py` | 19 tests for keypoint conversion, scaling, ratios |

| Removed | |
| --- | --- |
| `app/pose/landmarker.py` | archived to `legacy/mediapipe-pose-service/` |
| `pose_landmarker_full.task` | 9.4 MB MediaPipe bundle |
| `mediapipe`, `opencv-python-headless` | uninstalled from the venv |

`registry.py` (17 COCO keypoints), `angles.py` (2-D), `base.py` (pixel
resolution + `ratio` type), `codes.py` (4 new codes), `seed-exercises.ts` (5
exercises) and `PoseOverlay.tsx` (COCO skeleton) were all rewritten in place.

## Testing

| Suite | Before | After | Result |
| --- | --- | --- | --- |
| Pose service (pytest) | 83 | **102** | all pass |
| Backend unit (Jest) | 60 | 60 | all pass |
| Backend e2e (real PostgreSQL) | 65 | 65 | all pass |
| Frontend (Vitest) | 52 | 52 | all pass |
| Live API verification | 53 | 53 | all pass |
| Live pose WebSocket | 19 | **19** | all pass |
| **Total** | 332 | **351** | **all pass** |

Live-verified against a real photo through the production WebSocket: person
detected, 17 keypoints returned, session activated, angles plausible
(knee 154.7°, hip 122.4°, knee/ankle ratio 0.60), latency measured.

The database was backed up first (`.pgdump/physio_pre_yolo_*.sql`) and nothing
was deleted: 7 assignments, 45 sessions, 342 repetitions and 16 reports all
survive, and every retired rule config is kept as an inactive version so
historical reports still resolve the thresholds that judged them.

## Not verified

Live webcam rep counting with the new thresholds. The pipeline is verified end
to end with a still image, but whether a real bicep curl now crosses 150° → 60°
→ 150° on your camera is exactly what the earlier bug was about, and it needs a
person in front of a webcam.

`POSE_REP_DIAGNOSTICS=1` is set on the running pose service. It logs one line
per second per session showing the live primary angle, both limbs, the state
and the thresholds:

```
REPDIAG frame=40 state=GOING_DOWN reps=0 tracking=ok elbow=98.3
        (rest>=150 peak<=60) limbs=leftElbow=98 rightElbow=171
```

That will show immediately whether a movement is reaching the thresholds.
