# Archived: MediaPipe pose detector

Superseded on 29 August 2026, when the project moved to YOLOv8 (ultralytics)
using the detector from the team's own `FYP/FYP/physio_backend/` prototype.

Contents:

| File | Was |
| --- | --- |
| `landmarker.py` | MediaPipe Tasks `PoseLandmarker` wrapper (33 landmarks, 3-D world coordinates, per-session stateful VIDEO-mode detector) |
| `download_model.py` | Fetched `pose_landmarker_full.task` from Google's model store |

Kept because it is the only record of the 3-D pipeline. The replacement is
`services/pose-service/app/pose/detector.py`.

The substantive difference, for the report: MediaPipe returned metric world
landmarks with the origin at the hip midpoint, so joint angles were
scale-invariant and independent of camera position. YOLOv8 pose returns 2-D
pixel keypoints only, so every angle is now a projection into the image plane
and depends on where the patient stands relative to the camera.
