"""OpenCV camera streaming with YOLO pose detection."""

import base64
import threading
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

from yolo.pose_detector import get_pose_detector

_camera_lock = threading.Lock()
_capture: Optional[cv2.VideoCapture] = None
_camera_index: int = 0
_is_running: bool = False
_latest_frame: Optional[np.ndarray] = None
_latest_keypoints: Dict = {}
_latest_annotated: Optional[np.ndarray] = None


class CameraError(Exception):
    """Raised when camera operations fail."""


def start_camera(camera_index: int = 0) -> dict:
    """Open webcam and start capture."""
    global _capture, _camera_index, _is_running, _latest_frame, _latest_keypoints, _latest_annotated

    with _camera_lock:
        if _is_running and _capture is not None and _capture.isOpened():
            return {
                "message": "Camera already running",
                "status": "active",
                "camera_index": _camera_index,
            }

        release_camera()

        _capture = cv2.VideoCapture(camera_index)
        if not _capture.isOpened():
            _capture = None
            raise CameraError(
                f"Camera unavailable at index {camera_index}. "
                "Check that a webcam is connected and not in use by another application."
            )

        _camera_index = camera_index
        _is_running = True
        _latest_frame = None
        _latest_keypoints = {}
        _latest_annotated = None

        return {
            "message": "Camera started successfully",
            "status": "active",
            "camera_index": _camera_index,
        }


def process_frame() -> Tuple[Optional[np.ndarray], Dict, Optional[np.ndarray]]:
    """
    Read a frame, run pose detection, and return raw frame, keypoints, annotated frame.
    """
    global _latest_frame, _latest_keypoints, _latest_annotated

    with _camera_lock:
        if not _is_running or _capture is None or not _capture.isOpened():
            raise CameraError("Camera is not running. Call start_camera() first.")

        ret, frame = _capture.read()
        if not ret or frame is None:
            raise CameraError("Failed to read frame from camera")

        _latest_frame = frame

        try:
            detector = get_pose_detector()
            keypoints, annotated = detector.detect(frame)
        except RuntimeError as exc:
            raise CameraError(str(exc)) from exc

        _latest_keypoints = keypoints
        _latest_annotated = annotated

        return frame, keypoints, annotated


def get_latest_data() -> Tuple[Optional[np.ndarray], Dict, Optional[np.ndarray]]:
    """Return cached latest frame data without reading a new frame."""
    with _camera_lock:
        return _latest_frame, _latest_keypoints.copy(), _latest_annotated


def frame_to_base64(frame: np.ndarray, quality: int = 80) -> str:
    """Encode frame as JPEG base64 string."""
    _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buffer).decode("utf-8")


def release_camera() -> dict:
    """Release camera resources."""
    global _capture, _is_running, _latest_frame, _latest_keypoints, _latest_annotated

    with _camera_lock:
        if _capture is not None:
            _capture.release()
            _capture = None
        _is_running = False
        _latest_frame = None
        _latest_keypoints = {}
        _latest_annotated = None

    return {"message": "Camera released", "status": "stopped"}


def is_camera_running() -> bool:
    with _camera_lock:
        return _is_running and _capture is not None and _capture.isOpened()
