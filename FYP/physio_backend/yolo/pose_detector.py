"""YOLOv8 Pose detection module."""

from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from ultralytics import YOLO

CONFIDENCE_THRESHOLD = 0.5
MODEL_NAME = "yolov8n-pose.pt"

# COCO pose keypoint indices used by YOLOv8
COCO_KEYPOINT_NAMES = {
    0: "nose",
    1: "left_eye",
    2: "right_eye",
    3: "left_ear",
    4: "right_ear",
    5: "left_shoulder",
    6: "right_shoulder",
    7: "left_elbow",
    8: "right_elbow",
    9: "left_wrist",
    10: "right_wrist",
    11: "left_hip",
    12: "right_hip",
    13: "left_knee",
    14: "right_knee",
    15: "left_ankle",
    16: "right_ankle",
}

# Skeleton connections for drawing
SKELETON_CONNECTIONS = [
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 11),
    (6, 12),
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
    (0, 5),
    (0, 6),
]


class PoseDetector:
    """YOLOv8 pose estimation wrapper."""

    def __init__(self, model_path: str = MODEL_NAME):
        self.model_path = model_path
        self.model: Optional[YOLO] = None
        self._load_model()

    def _load_model(self):
        try:
            self.model = YOLO(self.model_path)
        except Exception as exc:
            raise RuntimeError(f"Failed to load YOLO model '{self.model_path}': {exc}") from exc

    def detect(self, frame: np.ndarray) -> Tuple[Dict[str, Dict], Optional[np.ndarray]]:
        """
        Run pose detection on a frame.

        Returns:
            keypoints dict and annotated frame.
        """
        if self.model is None:
            raise RuntimeError("YOLO model is not loaded")

        results = self.model(frame, verbose=False)
        annotated = frame.copy()
        keypoints: Dict[str, Dict] = {}

        if not results or results[0].keypoints is None:
            return keypoints, annotated

        kpts_data = results[0].keypoints
        if kpts_data.xy is None or len(kpts_data.xy) == 0:
            return keypoints, annotated

        # Use the first detected person
        person_xy = kpts_data.xy[0].cpu().numpy()
        person_conf = (
            kpts_data.conf[0].cpu().numpy()
            if kpts_data.conf is not None
            else np.ones(len(person_xy))
        )

        for idx, (x, y) in enumerate(person_xy):
            conf = float(person_conf[idx]) if idx < len(person_conf) else 0.0
            if conf < CONFIDENCE_THRESHOLD:
                continue
            name = COCO_KEYPOINT_NAMES.get(idx)
            if name:
                keypoints[name] = {"x": float(x), "y": float(y), "confidence": conf}

        annotated = self._draw_skeleton(annotated, person_xy, person_conf)
        return keypoints, annotated

    def _draw_skeleton(
        self,
        frame: np.ndarray,
        keypoints_xy: np.ndarray,
        keypoints_conf: np.ndarray,
    ) -> np.ndarray:
        """Draw skeleton and joint markers on frame."""
        h, w = frame.shape[:2]

        for i, j in SKELETON_CONNECTIONS:
            if i >= len(keypoints_xy) or j >= len(keypoints_xy):
                continue
            if keypoints_conf[i] < CONFIDENCE_THRESHOLD or keypoints_conf[j] < CONFIDENCE_THRESHOLD:
                continue
            pt1 = (int(keypoints_xy[i][0]), int(keypoints_xy[i][1]))
            pt2 = (int(keypoints_xy[j][0]), int(keypoints_xy[j][1]))
            cv2.line(frame, pt1, pt2, (0, 255, 0), 2)

        for idx, (x, y) in enumerate(keypoints_xy):
            if idx >= len(keypoints_conf) or keypoints_conf[idx] < CONFIDENCE_THRESHOLD:
                continue
            name = COCO_KEYPOINT_NAMES.get(idx, str(idx))
            center = (int(x), int(y))
            cv2.circle(frame, center, 5, (0, 0, 255), -1)
            cv2.putText(
                frame,
                name.replace("_", " "),
                (center[0] + 6, center[1] - 6),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.35,
                (255, 255, 255),
                1,
            )

        return frame

    def get_required_joints(self, joint_names: List[str]) -> bool:
        """Check if all required joint names are valid."""
        valid = set(COCO_KEYPOINT_NAMES.values())
        return all(j in valid for j in joint_names)


# Singleton instance
_pose_detector: Optional[PoseDetector] = None


def get_pose_detector() -> PoseDetector:
    global _pose_detector
    if _pose_detector is None:
        _pose_detector = PoseDetector()
    return _pose_detector
