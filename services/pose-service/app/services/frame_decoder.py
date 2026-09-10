"""JPEG frame decoding and validation."""

from __future__ import annotations

import logging
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class FrameDecodeError(ValueError):
    """The bytes received were not a decodable image."""


def decode_frame(payload: bytes, *, max_bytes: int) -> np.ndarray:
    """Decode raw JPEG/PNG bytes into a BGR numpy array.

    Validation is deliberately defensive: this is the one place untrusted
    binary from a browser enters the service.

    * Size is checked BEFORE decoding, so a decompression bomb cannot allocate.
    * An empty or malformed buffer raises rather than yielding a black frame -
      a black frame would be silently analysed as "no person detected", which
      hides the real problem from the patient.
    * Unexpected channel counts are normalised to 3-channel BGR.
    """
    if not payload:
        raise FrameDecodeError("Empty frame payload")
    if len(payload) > max_bytes:
        raise FrameDecodeError(
            f"Frame is {len(payload)} bytes, limit is {max_bytes}"
        )

    buffer = np.frombuffer(payload, dtype=np.uint8)
    frame: Optional[np.ndarray] = cv2.imdecode(buffer, cv2.IMREAD_COLOR)

    if frame is None or frame.size == 0:
        raise FrameDecodeError("Frame bytes could not be decoded as an image")

    if frame.ndim == 2:
        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
    elif frame.shape[2] == 4:
        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

    height, width = frame.shape[:2]
    if height < 64 or width < 64:
        raise FrameDecodeError(f"Frame too small to analyse: {width}x{height}")

    return frame


def resize_max_width(frame: np.ndarray, max_width: int) -> np.ndarray:
    """Downscale if wider than max_width, preserving aspect ratio.

    The browser already samples at POSE_IMAGE_WIDTH, so this is a server-side
    backstop against a client that ignores the configured value.
    """
    height, width = frame.shape[:2]
    if width <= max_width:
        return frame
    scale = max_width / float(width)
    return cv2.resize(
        frame,
        (max_width, int(height * scale)),
        interpolation=cv2.INTER_AREA,
    )
