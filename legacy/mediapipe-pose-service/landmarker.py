"""MediaPipe Tasks PoseLandmarker wrapper.

Why the Tasks API and not `mp.solutions.pose`
---------------------------------------------
The legacy `mediapipe.solutions.*` package no longer exists. Verified by
unzipping the actual wheels: mediapipe 0.10.30, 0.10.35 and 1.0.1 all ship a
Tasks-only tree, and `mediapipe/__init__.py` in 1.0.1 exports exactly three
names - `tasks`, `Image`, `ImageFormat`. Any tutorial using `mp.solutions.pose`
cannot run on a current install. See docs/POSE_SERVICE.md.

Detector isolation
------------------
`PoseLandmarker` in VIDEO mode is STATEFUL: it tracks a person across frames
and requires monotonically increasing timestamps. Sharing one instance between
two patients would leak tracking state between them and break the timestamp
sequence. Each live session therefore gets its own detector, taken from a
bounded pool so that a burst of connections cannot exhaust memory.

At FYP concurrency (a handful of simultaneous sessions) correctness beats
throughput, which is why this is a pool of independent detectors rather than
one shared instance guarded by a lock.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Optional

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from app.landmarks.registry import (
    INDEX_TO_LANDMARK,
    Landmark,
    Point3D,
    PoseFrame,
)

logger = logging.getLogger(__name__)


class ModelNotAvailableError(RuntimeError):
    """The .task bundle is missing. The service must not pretend to work."""


class PoseDetector:
    """One MediaPipe detector bound to one session."""

    def __init__(
        self,
        model_path: Path,
        *,
        num_poses: int = 2,
        min_detection_confidence: float = 0.5,
        min_presence_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
    ) -> None:
        if not model_path.exists():
            raise ModelNotAvailableError(
                f"Pose model not found at {model_path}. "
                "Run: python scripts/download_model.py"
            )

        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            # 2 rather than 1 so MULTIPLE_PEOPLE can actually be *detected*.
            # Claiming to warn about bystanders while only ever asking for one
            # pose would make the warning impossible to trigger.
            num_poses=num_poses,
            min_pose_detection_confidence=min_detection_confidence,
            min_pose_presence_confidence=min_presence_confidence,
            min_tracking_confidence=min_tracking_confidence,
            output_segmentation_masks=False,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self._closed = False
        #: VIDEO mode rejects non-increasing timestamps, so the service owns
        #: the clock rather than trusting whatever the browser sends.
        self._last_timestamp_ms = -1

    def detect(
        self, bgr_frame: np.ndarray, timestamp_ms: Optional[int] = None
    ) -> tuple[list[PoseFrame], int, float]:
        """Run pose estimation on one BGR frame.

        Returns (poses, people_detected, inference_ms).
        """
        if self._closed:
            raise RuntimeError("Detector already closed")

        if timestamp_ms is None:
            timestamp_ms = int(time.monotonic() * 1000)
        if timestamp_ms <= self._last_timestamp_ms:
            timestamp_ms = self._last_timestamp_ms + 1
        self._last_timestamp_ms = timestamp_ms

        # MediaPipe expects RGB; OpenCV decodes BGR.
        rgb = bgr_frame[:, :, ::-1].copy()
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        started = time.perf_counter()
        result = self._landmarker.detect_for_video(image, timestamp_ms)
        inference_ms = (time.perf_counter() - started) * 1000.0

        people = len(result.pose_landmarks)
        if people == 0:
            return [], 0, inference_ms

        poses: list[PoseFrame] = []
        for index in range(people):
            normalized = _to_named(result.pose_landmarks[index])
            world = (
                _to_named(result.pose_world_landmarks[index])
                if index < len(result.pose_world_landmarks)
                else {}
            )
            poses.append(PoseFrame(normalized=normalized, world=world))

        return poses, people, inference_ms

    def close(self) -> None:
        if not self._closed:
            try:
                self._landmarker.close()
            except Exception:  # noqa: BLE001 - shutdown must never raise
                logger.debug("Detector close raised", exc_info=True)
            self._closed = True


def _to_named(landmarks: list) -> dict[Landmark, Point3D]:
    """Convert MediaPipe's positional list into named points.

    Only the subset this application uses is retained - face detail and hand
    points are dropped, which keeps the WebSocket payload small.
    """
    named: dict[Landmark, Point3D] = {}
    for index, landmark in enumerate(landmarks):
        name = INDEX_TO_LANDMARK.get(index)
        if name is None:
            continue
        named[name] = Point3D(
            x=float(landmark.x),
            y=float(landmark.y),
            z=float(landmark.z),
            # World landmarks carry no visibility; fall back to 1.0 so that
            # gating is driven by the normalized values, which do have it.
            visibility=float(getattr(landmark, "visibility", None) or 0.0),
            presence=float(getattr(landmark, "presence", None) or 0.0),
        )
    return named


def select_primary_pose(poses: list[PoseFrame]) -> Optional[PoseFrame]:
    """Choose which detected person to analyse.

    Selection rule, stated explicitly because silently analysing the wrong
    person would be a clinical data-integrity problem: the pose whose torso
    bounding box (shoulders to hips, in normalized coordinates) has the LARGEST
    area is chosen, on the assumption that the patient is closest to the camera.

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
    """Bounded pool of per-session detectors.

    Each session leases exactly one detector for its lifetime. Loading a model
    takes roughly half a second, so one detector is created eagerly at startup
    to pay that cost before the first patient rather than during their session.
    """

    def __init__(
        self,
        model_path: Path,
        *,
        max_detectors: int,
        num_poses: int = 2,
        min_detection_confidence: float = 0.5,
        min_presence_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
    ) -> None:
        self._model_path = model_path
        self._max = max_detectors
        self._kwargs = {
            "num_poses": num_poses,
            "min_detection_confidence": min_detection_confidence,
            "min_presence_confidence": min_presence_confidence,
            "min_tracking_confidence": min_tracking_confidence,
        }
        self._lock = threading.Lock()
        self._leased = 0
        self._model_ok = False

    def warm_up(self) -> float:
        """Load and immediately release one detector. Returns load time in ms."""
        started = time.perf_counter()
        detector = PoseDetector(self._model_path, **self._kwargs)
        blank = np.zeros((256, 256, 3), dtype=np.uint8)
        detector.detect(blank, timestamp_ms=0)
        detector.close()
        self._model_ok = True
        return (time.perf_counter() - started) * 1000.0

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
            return PoseDetector(self._model_path, **self._kwargs)
        except Exception:
            with self._lock:
                self._leased -= 1
            raise

    def release(self, detector: PoseDetector) -> None:
        detector.close()
        with self._lock:
            self._leased = max(0, self._leased - 1)


class CapacityExceededError(RuntimeError):
    """Too many concurrent sessions for this machine."""
