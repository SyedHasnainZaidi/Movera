"""Named access to YOLOv8 pose keypoints.

The detector is YOLOv8n-pose (ultralytics), which emits the 17-point COCO
keypoint set. The index table below is a verbatim copy of
`COCO_KEYPOINT_NAMES` from the project's own `yolo/pose_detector.py`, so the
mapping from array position to joint name has exactly one definition and it is
the one the prototype already used.

Everything downstream is addressed BY NAME. The superseded prototypes indexed
landmarks directly - `lm[23]`, `lm[25]` - which is unreadable and is how
left/right mix-ups happen silently.

Coordinate space
----------------
YOLOv8 pose returns PIXEL coordinates in the frame it was given, plus a
per-keypoint confidence. There is no metric/world space and no depth: this is a
2-D detector. Joint angles are therefore computed in the image plane, exactly
as `analysis/angle_calculation.py` did in the prototype.

The practical consequence, recorded here because it affects every threshold in
every rule config: a 2-D angle depends on where the camera is. A bicep curl
performed side-on measures correctly; the same curl performed facing the camera
foreshortens the forearm and reads too large. Patients must be framed as the
exercise instructions describe.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Mapping, Sequence


class Landmark(str, Enum):
    """The 17 COCO keypoints produced by YOLOv8 pose.

    Values are the snake_case wire names used in rule configs and API payloads,
    unchanged from the prototype's analyzers so its exercise rules port across
    without a rename.
    """

    NOSE = "nose"
    LEFT_EYE = "left_eye"
    RIGHT_EYE = "right_eye"
    LEFT_EAR = "left_ear"
    RIGHT_EAR = "right_ear"

    LEFT_SHOULDER = "left_shoulder"
    RIGHT_SHOULDER = "right_shoulder"
    LEFT_ELBOW = "left_elbow"
    RIGHT_ELBOW = "right_elbow"
    LEFT_WRIST = "left_wrist"
    RIGHT_WRIST = "right_wrist"

    LEFT_HIP = "left_hip"
    RIGHT_HIP = "right_hip"
    LEFT_KNEE = "left_knee"
    RIGHT_KNEE = "right_knee"
    LEFT_ANKLE = "left_ankle"
    RIGHT_ANKLE = "right_ankle"


#: The single place where a keypoint name becomes a YOLO array index.
#: Copied from yolo/pose_detector.py COCO_KEYPOINT_NAMES.
LANDMARK_INDEX: Mapping[Landmark, int] = {
    Landmark.NOSE: 0,
    Landmark.LEFT_EYE: 1,
    Landmark.RIGHT_EYE: 2,
    Landmark.LEFT_EAR: 3,
    Landmark.RIGHT_EAR: 4,
    Landmark.LEFT_SHOULDER: 5,
    Landmark.RIGHT_SHOULDER: 6,
    Landmark.LEFT_ELBOW: 7,
    Landmark.RIGHT_ELBOW: 8,
    Landmark.LEFT_WRIST: 9,
    Landmark.RIGHT_WRIST: 10,
    Landmark.LEFT_HIP: 11,
    Landmark.RIGHT_HIP: 12,
    Landmark.LEFT_KNEE: 13,
    Landmark.RIGHT_KNEE: 14,
    Landmark.LEFT_ANKLE: 15,
    Landmark.RIGHT_ANKLE: 16,
}

#: Reverse lookup, used when converting a YOLO result into named points.
INDEX_TO_LANDMARK: Mapping[int, Landmark] = {
    index: name for name, index in LANDMARK_INDEX.items()
}

#: Skeleton edges the browser draws. Kept here so the server and the overlay
#: never disagree about what connects to what.
#:
#: Derived from SKELETON_CONNECTIONS in yolo/pose_detector.py. COCO has no
#: heel or foot-index points, so the two foot edges the MediaPipe skeleton drew
#: are gone - the leg now ends at the ankle.
SKELETON_EDGES: Sequence[tuple[Landmark, Landmark]] = (
    (Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER),
    (Landmark.LEFT_SHOULDER, Landmark.LEFT_ELBOW),
    (Landmark.LEFT_ELBOW, Landmark.LEFT_WRIST),
    (Landmark.RIGHT_SHOULDER, Landmark.RIGHT_ELBOW),
    (Landmark.RIGHT_ELBOW, Landmark.RIGHT_WRIST),
    (Landmark.LEFT_SHOULDER, Landmark.LEFT_HIP),
    (Landmark.RIGHT_SHOULDER, Landmark.RIGHT_HIP),
    (Landmark.LEFT_HIP, Landmark.RIGHT_HIP),
    (Landmark.LEFT_HIP, Landmark.LEFT_KNEE),
    (Landmark.LEFT_KNEE, Landmark.LEFT_ANKLE),
    (Landmark.RIGHT_HIP, Landmark.RIGHT_KNEE),
    (Landmark.RIGHT_KNEE, Landmark.RIGHT_ANKLE),
    (Landmark.NOSE, Landmark.LEFT_SHOULDER),
    (Landmark.NOSE, Landmark.RIGHT_SHOULDER),
)


@dataclass(frozen=True, slots=True)
class Keypoint:
    """One detected joint, in image-pixel coordinates.

    `confidence` is YOLO's own per-keypoint score in [0,1]. It replaces
    MediaPipe's separate visibility/presence pair, and it is what the
    prototype's `get_joint(..., min_confidence=0.5)` gated on.
    """

    x: float
    y: float
    confidence: float

    @property
    def is_reliable(self) -> bool:
        return self.confidence > 0.0


@dataclass(frozen=True, slots=True)
class PoseFrame:
    """One detected person.

    Two views of the same points:

    * **pixels** - what YOLO returned, in the coordinate frame of the analysed
      image. Angles and every pixel-distance rule are computed from these,
      because that is the space the prototype's thresholds were tuned in.
    * **normalized** - x/width, y/height in [0,1]. Sent to the browser so the
      overlay can scale to whatever size the video element happens to be.
      Never used for angles: dividing x by width and y by height skews every
      angle on a non-square frame.
    """

    pixels: Mapping[Landmark, Keypoint]
    normalized: Mapping[Landmark, Keypoint]
    #: Size of the frame the pixel coordinates refer to.
    width: int
    height: int

    def visibility_of(self, landmark: Landmark) -> float:
        point = self.pixels.get(landmark)
        return point.confidence if point else 0.0


def landmark_names(landmarks: Iterable[Landmark]) -> list[str]:
    return [landmark.value for landmark in landmarks]


def parse_landmark(value: str) -> Landmark | None:
    """Tolerantly resolve a rule-config string to a Landmark.

    Accepts both wire form (`left_knee`) and enum form (`LEFT_KNEE`) so that a
    hand-written rule config does not fail silently on case.

    Returns None for a name YOLO cannot provide - notably the MediaPipe-only
    heel and foot-index points, which any rule config inherited from the
    MediaPipe era may still mention.
    """
    try:
        return Landmark(value.strip().lower())
    except ValueError:
        try:
            return Landmark[value.strip().upper()]
        except KeyError:
            return None
