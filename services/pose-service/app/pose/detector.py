"""YOLOv8 pose detection.

Ported from `yolo/pose_detector.py` in the project's FastAPI prototype. The
model choice (`yolov8n-pose.pt`), the COCO keypoint mapping and the 0.5
confidence gate are all carried over unchanged; see legacy/README.md.

What is different from the prototype
------------------------------------
* **No frame is drawn on.** The prototype's detector also rendered an annotated
  JPEG (`_draw_skeleton`) and shipped it back. Here the browser already has the
  video and draws the skeleton itself from normalized coordinates, so encoding
  a second image server-side would be wasted work on the hot path.
* **All detected people are returned**, not just `keypoints.xy[0]`. Taking
  index 0 silently analyses whichever person YOLO happened to list first;
  `select_primary_pose` picks deliberately and the UI warns when it had to.
* **The model is loaded once and shared.** YOLOv8 inference is stateless - each
  `predict` call is independent - so unlike MediaPipe's VIDEO-mode landmarker
  there is nothing to leak between sessions and no per-session instance is
  needed. Sessions are still capped, but by an explicit slot count rather than
  by how many models fit in memory.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from ultralytics import YOLO

from app.landmarks.registry import (
    INDEX_TO_LANDMARK,
    Keypoint,
    Landmark,
    PoseFrame,
)

logger = logging.getLogger(__name__)

#: Carried over verbatim from the prototype's pose_detector.py.
CONFIDENCE_THRESHOLD = 0.5

#: Inference resolution, in pixels, and it must be a multiple of 32.
#:
#: Ultralytics defaults to 640: it letterboxes whatever it is given up to
#: 640x640 and runs the network at that size. The browser sends 480-wide
#: frames, so the default spends most of its time on pixels that were invented
#: by the upscale. Measured on the 4-core development machine, per frame:
#:
#:     imgsz=640   ~205 ms
#:     imgsz=480   ~135 ms
#:     imgsz=320    ~90 ms
#:
#: 480 matches the frames actually being sent, which is the honest choice -
#: nothing is thrown away and nothing is fabricated.
DEFAULT_IMAGE_SIZE = 480


def _configure_torch_threads() -> int:
    """Let torch use every core.

    torch defaults to roughly half the logical CPUs on Windows, which on a
    4-core machine means 2 - and pose inference is the one thing this service
    does. Measured: 4 threads is about 10% faster than 2 here, and going beyond
    the core count is slower again through contention.
    """
    cores = os.cpu_count() or 2
    try:
        torch.set_num_threads(cores)
    except Exception:  # noqa: BLE001 - a thread-count hint must never be fatal
        logger.debug("Could not set torch thread count", exc_info=True)
    return torch.get_num_threads()


class ModelNotAvailableError(RuntimeError):
    """The .pt weights are missing. The service must not pretend to work."""


class PoseDetector:
    """YOLOv8 pose estimation wrapper.

    Thread-safe by construction: `predict` is guarded by a lock, because a
    single ultralytics model is not documented as safe for concurrent calls and
    a torn read here would corrupt one patient's frame with another's.
    """

    def __init__(
        self,
        model_path: Path,
        *,
        confidence: float = CONFIDENCE_THRESHOLD,
        max_people: int = 2,
        image_size: int = DEFAULT_IMAGE_SIZE,
    ) -> None:
        if not model_path.exists():
            raise ModelNotAvailableError(
                f"YOLO pose weights not found at {model_path}. "
                "Run: python scripts/download_model.py"
            )
        self._confidence = confidence
        self._max_people = max_people
        # Rounded down to a multiple of 32; the network stride requires it and
        # ultralytics would otherwise silently round it itself.
        self._image_size = max(32, (image_size // 32) * 32)
        self._lock = threading.Lock()

        threads = _configure_torch_threads()
        try:
            self._model = YOLO(str(model_path))
        except Exception as exc:  # noqa: BLE001 - surfaced as a typed error
            raise ModelNotAvailableError(
                f"Failed to load YOLO model '{model_path}': {exc}"
            ) from exc
        self._closed = False
        logger.info(
            "YOLO pose detector ready: %s (imgsz=%d, torch threads=%d)",
            model_path.name,
            self._image_size,
            threads,
        )

    def detect(
        self, bgr_frame: np.ndarray, timestamp_ms: Optional[int] = None
    ) -> tuple[list[PoseFrame], int, float]:
        """Run pose estimation on one BGR frame.

        Returns (poses, people_detected, inference_ms).

        `timestamp_ms` is accepted and ignored. YOLOv8 is stateless, unlike the
        MediaPipe VIDEO-mode landmarker this replaced, which required
        monotonically increasing timestamps. The parameter is kept so the call
        site did not have to change.
        """
        if self._closed:
            raise RuntimeError("Detector already closed")

        height, width = bgr_frame.shape[:2]

        started = time.perf_counter()
        with self._lock:
            # verbose=False: ultralytics otherwise prints a line per frame.
            results = self._model(
                bgr_frame, verbose=False, imgsz=self._image_size
            )
        inference_ms = (time.perf_counter() - started) * 1000.0

        if not results:
            return [], 0, inference_ms

        keypoints = results[0].keypoints
        if keypoints is None or keypoints.xy is None or len(keypoints.xy) == 0:
            return [], 0, inference_ms

        people = min(len(keypoints.xy), self._max_people)
        poses: list[PoseFrame] = []

        for index in range(people):
            xy = keypoints.xy[index].cpu().numpy()
            conf = (
                keypoints.conf[index].cpu().numpy()
                if keypoints.conf is not None
                else np.ones(len(xy), dtype=np.float32)
            )
            frame = _to_pose_frame(xy, conf, width, height, self._confidence)
            if frame is not None:
                poses.append(frame)

        return poses, len(poses), inference_ms

    def close(self) -> None:
        # Nothing to release: the model is owned by the pool, and this method
        # exists so the pool's lease/release contract is unchanged.
        self._closed = True


def _to_pose_frame(
    xy: np.ndarray,
    conf: np.ndarray,
    width: int,
    height: int,
    min_confidence: float,
) -> Optional[PoseFrame]:
    """Convert one person's YOLO output into named pixel and normalized points.

    Keypoints below `min_confidence` are DROPPED rather than included with a
    low score, matching the prototype's `get_joint` gate. A missing keypoint is
    unambiguous downstream: the angle that needed it returns None and the rep
    counter freezes, which is the correct response to not being able to see a
    joint.
    """
    pixels: dict[Landmark, Keypoint] = {}
    normalized: dict[Landmark, Keypoint] = {}

    for index, point in enumerate(xy):
        name = INDEX_TO_LANDMARK.get(index)
        if name is None:
            continue
        confidence = float(conf[index]) if index < len(conf) else 0.0
        if confidence < min_confidence:
            continue

        x = float(point[0])
        y = float(point[1])
        # YOLO occasionally emits (0,0) for a keypoint it could not place at
        # all while still reporting a usable confidence. A joint at the exact
        # frame origin is not a real detection.
        if x == 0.0 and y == 0.0:
            continue

        pixels[name] = Keypoint(x=x, y=y, confidence=confidence)
        normalized[name] = Keypoint(
            x=x / width if width else 0.0,
            y=y / height if height else 0.0,
            confidence=confidence,
        )

    if not pixels:
        return None

    return PoseFrame(
        pixels=pixels, normalized=normalized, width=width, height=height
    )


def select_primary_pose(poses: list[PoseFrame]) -> Optional[PoseFrame]:
    """Choose which detected person to analyse.

    Selection rule, stated explicitly because silently analysing the wrong
    person would be a clinical data-integrity problem: the pose whose torso
    bounding box (shoulders to hips, in normalized coordinates) has the LARGEST
    area is chosen, on the assumption that the patient is closest to the camera.

    The prototype took `keypoints.xy[0]` - whichever person YOLO listed first,
    which is by detection confidence and not by who is being treated.

    The UI still shows a MULTIPLE_PEOPLE warning whenever this rule has to be
    applied - the system never quietly picks someone.
    """
    if not poses:
        return None
    if len(poses) == 1:
        return poses[0]

    def torso_area(pose: PoseFrame) -> float:
        corners = [
            pose.normalized.get(Landmark.LEFT_SHOULDER),
            pose.normalized.get(Landmark.RIGHT_SHOULDER),
            pose.normalized.get(Landmark.LEFT_HIP),
            pose.normalized.get(Landmark.RIGHT_HIP),
        ]
        present = [c for c in corners if c is not None]
        if len(present) < 2:
            return 0.0
        width = max(c.x for c in present) - min(c.x for c in present)
        height = max(c.y for c in present) - min(c.y for c in present)
        return abs(width * height)

    return max(poses, key=torso_area)


class DetectorPool:
    """Bounded set of analysis slots over one shared YOLO model.

    The MediaPipe implementation this replaces created one stateful landmarker
    per session. YOLOv8 inference is stateless, so a single model serves every
    session and the pool's job is reduced to capping concurrency - which still
    matters, because each in-flight frame costs CPU.
    """

    def __init__(
        self,
        model_path: Path,
        *,
        max_detectors: int,
        confidence: float = CONFIDENCE_THRESHOLD,
        max_people: int = 2,
        image_size: int = DEFAULT_IMAGE_SIZE,
    ) -> None:
        self._model_path = model_path
        self._max = max_detectors
        self._kwargs = {
            "confidence": confidence,
            "max_people": max_people,
            "image_size": image_size,
        }
        self._lock = threading.Lock()
        self._leased = 0
        self._model_ok = False
        self._shared: Optional[PoseDetector] = None

    def warm_up(self) -> float:
        """Load the model and run one inference. Returns load time in ms.

        The first `predict` call is far slower than the rest - torch has to
        build its execution graph - so it is paid here at startup rather than
        inside a patient's first session.
        """
        started = time.perf_counter()
        detector = self._ensure_model()
        blank = np.zeros((256, 256, 3), dtype=np.uint8)
        detector.detect(blank)
        self._model_ok = True
        return (time.perf_counter() - started) * 1000.0

    def _ensure_model(self) -> PoseDetector:
        with self._lock:
            if self._shared is None:
                self._shared = PoseDetector(self._model_path, **self._kwargs)
            return self._shared

    @property
    def model_available(self) -> bool:
        return self._model_ok or self._model_path.exists()

    @property
    def leased(self) -> int:
        with self._lock:
            return self._leased

    @property
    def capacity(self) -> int:
        return self._max

    def acquire(self) -> PoseDetector:
        with self._lock:
            if self._leased >= self._max:
                raise CapacityExceededError(
                    f"All {self._max} analysis slots are in use."
                )
            self._leased += 1
        try:
            return self._ensure_model()
        except Exception:
            with self._lock:
                self._leased -= 1
            raise

    def release(self, detector: PoseDetector) -> None:
        # The model is shared, so it is NOT closed here - only the slot is
        # returned. Closing it would break every other live session.
        with self._lock:
            self._leased = max(0, self._leased - 1)


class CapacityExceededError(RuntimeError):
    """Too many concurrent sessions for this machine."""
