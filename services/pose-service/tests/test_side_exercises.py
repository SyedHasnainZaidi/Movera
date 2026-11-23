"""Side-specific exercises, end to end through the real analyzer.

Trunk Flexion, Neck Side Bend, Knee Extension, Standing Hip Extension and
Elbow Extension are tested here against the EXACT rule configs the backend
seeds - `fixtures/side_exercise_rule_configs.json` is exported from
`apps/backend/prisma/seed-exercises.ts`, and a backend Jest test fails if the
two drift apart.

Every test builds a synthetic skeleton whose joint angles are exact (no camera,
no model), so each assertion is about the analysis logic itself:

  * a complete movement cycle counts exactly one repetition;
  * a partial movement, or jitter around a threshold, counts none;
  * the WRONG camera orientation or the wrong side towards the camera pauses
    counting, even through a full movement;
  * the selected side drives the count - moving the other limb counts nothing;
  * exercise-specific posture faults produce exercise-specific messages.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterable, Optional

import pytest

from app.exercises.base import BaseExerciseAnalyzer, RuleConfig
from app.exercises.registry import build_analyzer, is_supported
from app.feedback.codes import ErrorCode
from app.landmarks.registry import Keypoint, Landmark, PoseFrame

FIXTURE = Path(__file__).parent / "fixtures" / "side_exercise_rule_configs.json"
CONFIGS: dict = json.loads(FIXTURE.read_text(encoding="utf-8"))

FRAME_W = 480
FRAME_H = 480
FRAME_DT = 0.1  # seconds between frames - roughly the browser's sample rate

NEAR_CONFIDENCE = 0.95
FAR_CONFIDENCE = 0.7

Vec = tuple[float, float]


# ---------------------------------------------------------------------------
# Vector helpers
# ---------------------------------------------------------------------------


def add(a: Vec, b: Vec, scale: float = 1.0) -> Vec:
    return (a[0] + b[0] * scale, a[1] + b[1] * scale)


def combine(a: Vec, wa: float, b: Vec, wb: float) -> Vec:
    return (a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb)


class Frame:
    """Sagittal-plane basis for a patient standing side-on.

    ``u`` points up the patient's body, ``w`` points the way they face. Image
    +Y is down, so "up" is (0, -1). ``facing`` is +1 when the patient faces
    the right-hand edge of the picture, -1 for the left-hand edge.
    """

    def __init__(self, facing: int = 1, trunk_deg: float = 0.0) -> None:
        t = math.radians(trunk_deg)
        self.f = facing
        # Trunk tipped forward by trunk_deg.
        self.u: Vec = (facing * math.sin(t), -math.cos(t))
        self.w: Vec = (facing * math.cos(t), math.sin(t))

    def decompose(self, v: Vec) -> tuple[float, float]:
        return (
            v[0] * self.u[0] + v[1] * self.u[1],
            v[0] * self.w[0] + v[1] * self.w[1],
        )

    def posterior(self, v: Vec) -> Vec:
        """v rotated 90 degrees towards the back of the limb (u->w, w->-u)."""
        a, b = self.decompose(v)
        return combine(self.w, a, self.u, -b)


def rotate_from(frame: Frame, v: Vec, interior_deg: float, toward: Vec) -> Vec:
    """The distal segment of a joint whose interior angle is ``interior_deg``."""
    bend = math.radians(180.0 - interior_deg)
    return combine(v, math.cos(bend), toward, math.sin(bend))


# ---------------------------------------------------------------------------
# Skeleton builders
# ---------------------------------------------------------------------------


def side_view_pose(
    side: str,
    *,
    facing: int = 1,
    trunk_deg: float = 0.0,
    hip_flexion_deg: float = 0.0,
    knee_deg: float = 180.0,
    upper_arm_deg: float = 0.0,
    elbow_deg: float = 180.0,
    other_hip_flexion_deg: Optional[float] = None,
    other_knee_deg: Optional[float] = None,
    other_elbow_deg: Optional[float] = None,
    near_confidence: float = NEAR_CONFIDENCE,
    far_confidence: float = FAR_CONFIDENCE,
    shoulder_spread: float = 8.0,
) -> PoseFrame:
    """A patient side-on to the camera, the ``side`` half nearer the lens.

    hip_flexion_deg: thigh angle in front of the trunk line (negative =
    behind it, i.e. hip EXTENSION). knee_deg / elbow_deg are interior joint
    angles (180 = straight). upper_arm_deg tips the upper arm forward.
    """
    fr = Frame(facing, trunk_deg)
    hip: Vec = (240.0, 270.0)
    shoulder = add(hip, fr.u, 190.0)
    nose = add(add(shoulder, fr.u, 45.0), fr.w, 30.0)

    def leg(flex_deg: float, k_deg: float) -> tuple[Vec, Vec]:
        a = math.radians(flex_deg)
        # Down the trunk line (-u), rotated forward (towards w) by flex_deg.
        thigh = combine(fr.u, -math.cos(a), fr.w, math.sin(a))
        knee = add(hip, thigh, 170.0)
        shank = rotate_from(fr, thigh, k_deg, fr.posterior(thigh))
        return knee, add(knee, shank, 170.0)

    def arm(e_deg: float) -> tuple[Vec, Vec]:
        a = math.radians(upper_arm_deg)
        # Upper arm hanging straight down (gravity, not trunk), tipped forward.
        down: Vec = (0.0, 1.0)
        forward: Vec = (fr.f * 1.0, 0.0)
        upper = combine(down, math.cos(a), forward, math.sin(a))
        elbow = add(shoulder, upper, 110.0)
        # Elbow flexion brings the forearm FORWARD: anterior = -posterior.
        post = fr.posterior(upper)
        forearm = rotate_from(fr, upper, e_deg, (-post[0], -post[1]))
        return elbow, add(elbow, forearm, 100.0)

    near_knee, near_ankle = leg(hip_flexion_deg, knee_deg)
    far_knee, far_ankle = leg(
        hip_flexion_deg if other_hip_flexion_deg is None else other_hip_flexion_deg,
        knee_deg if other_knee_deg is None else other_knee_deg,
    )
    near_elbow, near_wrist = arm(elbow_deg)
    far_elbow, far_wrist = arm(elbow_deg if other_elbow_deg is None else other_elbow_deg)

    other = "right" if side == "left" else "left"
    spread = (shoulder_spread, 0.0)
    layout: dict[str, tuple[Vec, float]] = {
        "nose": (nose, near_confidence),
        f"{side}_shoulder": (shoulder, near_confidence),
        f"{other}_shoulder": (add(shoulder, spread), far_confidence),
        f"{side}_hip": (hip, near_confidence),
        f"{other}_hip": (add(hip, spread), far_confidence),
        f"{side}_knee": (near_knee, near_confidence),
        f"{other}_knee": (add(far_knee, spread), far_confidence),
        f"{side}_ankle": (near_ankle, near_confidence),
        f"{other}_ankle": (add(far_ankle, spread), far_confidence),
        f"{side}_elbow": (near_elbow, near_confidence),
        f"{other}_elbow": (add(far_elbow, spread), far_confidence),
        f"{side}_wrist": (near_wrist, near_confidence),
        f"{other}_wrist": (add(far_wrist, spread), far_confidence),
    }
    return _frame(layout)


def front_view_pose(
    *,
    neck_tilt_deg: float = 0.0,
    body_lean_deg: float = 0.0,
    shoulder_hike_px: float = 0.0,
    confidence: float = NEAR_CONFIDENCE,
    half_shoulder: float = 60.0,
) -> PoseFrame:
    """A patient facing the camera. Their LEFT is the image's right.

    neck_tilt_deg > 0 tips the head towards the patient's LEFT shoulder (the
    left eye drops). body_lean_deg tilts the whole upper body, head included,
    the same way - which must NOT read as a neck movement.
    """
    lean = math.radians(body_lean_deg)
    # Upper body rotated about the hip centre.
    hip_c: Vec = (240.0, 400.0)
    up: Vec = (math.sin(lean), -math.cos(lean))
    across: Vec = (math.cos(lean), math.sin(lean))  # towards patient's left

    sh_c = add(hip_c, up, 200.0)
    left_shoulder = add(sh_c, across, half_shoulder)
    right_shoulder = add(sh_c, across, -half_shoulder)
    left_shoulder = (left_shoulder[0], left_shoulder[1] - shoulder_hike_px)

    tilt = lean + math.radians(neck_tilt_deg)
    eye_dir: Vec = (math.cos(tilt), math.sin(tilt))
    eye_c = add(sh_c, up, 75.0)
    layout: dict[str, tuple[Vec, float]] = {
        "nose": (add(eye_c, up, -18.0), confidence),
        "left_eye": (add(eye_c, eye_dir, 18.0), confidence),
        "right_eye": (add(eye_c, eye_dir, -18.0), confidence),
        "left_shoulder": (left_shoulder, confidence),
        "right_shoulder": (right_shoulder, confidence),
        "left_hip": ((hip_c[0] + 35.0, hip_c[1]), confidence),
        "right_hip": ((hip_c[0] - 35.0, hip_c[1]), confidence),
    }
    return _frame(layout)


def _frame(layout: dict[str, tuple[Vec, float]]) -> PoseFrame:
    pixels: dict[Landmark, Keypoint] = {}
    normalized: dict[Landmark, Keypoint] = {}
    for name, ((x, y), confidence) in layout.items():
        landmark = Landmark(name)
        pixels[landmark] = Keypoint(x=x, y=y, confidence=confidence)
        normalized[landmark] = Keypoint(x=x / FRAME_W, y=y / FRAME_H, confidence=confidence)
    return PoseFrame(pixels=pixels, normalized=normalized, width=FRAME_W, height=FRAME_H)


# ---------------------------------------------------------------------------
# Analyzer driving
# ---------------------------------------------------------------------------


def make(slug: str, side: Optional[str]) -> BaseExerciseAnalyzer:
    payload = {
        **CONFIGS[slug]["ruleConfig"],
        "exerciseSlug": slug,
        "ruleConfigVersion": 1,
        "goalType": "REPS",
        "side": side,
    }
    return build_analyzer(RuleConfig.from_payload(payload))


class Runner:
    def __init__(self, analyzer: BaseExerciseAnalyzer) -> None:
        self.analyzer = analyzer
        self.now = 1000.0
        self.errors: set[ErrorCode] = set()
        self.messages: list[str] = []
        self.guidance: list[str] = []
        self.last = None

    def feed(self, frame: PoseFrame, frames: int = 1):
        for _ in range(frames):
            self.now += FRAME_DT
            result = self.analyzer.analyze(frame, people_detected=1, now=self.now)
            self.last = result
            for error in result.errors:
                self.errors.add(error.code)
                self.messages.append(error.message)
            if result.guidance:
                self.guidance.append(result.guidance)
        return self.last

    def sweep(self, poses: Iterable[PoseFrame], frames_each: int = 2) -> None:
        for pose in poses:
            self.feed(pose, frames_each)

    @property
    def reps(self) -> int:
        return self.analyzer.rep_count


def cycle(build, rest: float, peak: float, *, steps: int = 6, hold: int = 12):
    """Rest -> peak -> rest, as a list of (pose, frames) phases."""
    phases = [(build(rest), hold)]
    for i in range(1, steps + 1):
        phases.append((build(rest + (peak - rest) * i / steps), 2))
    phases.append((build(peak), hold))
    for i in range(steps - 1, -1, -1):
        phases.append((build(rest + (peak - rest) * i / steps), 2))
    phases.append((build(rest), hold))
    return phases


def run_cycles(runner: Runner, phases, times: int = 1) -> None:
    for _ in range(times):
        for pose, frames in phases:
            runner.feed(pose, frames)


# ---------------------------------------------------------------------------
# Exercise builders: angle of the primary movement -> skeleton
# ---------------------------------------------------------------------------


def trunk_pose(side: str, facing: int = 1, **kw):
    return lambda deg: side_view_pose(side, facing=facing, trunk_deg=deg, **kw)


def knee_ext_pose(side: str, **kw):
    # Seated: thigh 90 deg forward of the (upright) trunk line.
    kw.setdefault("hip_flexion_deg", 90.0)
    kw.setdefault("other_knee_deg", 90.0)
    return lambda deg: side_view_pose(side, knee_deg=deg, **kw)


def hip_ext_pose(side: str, **kw):
    # Extension is the thigh BEHIND the trunk line: negative flexion.
    kw.setdefault("other_hip_flexion_deg", 0.0)
    return lambda deg: side_view_pose(side, hip_flexion_deg=-deg, **kw)


def elbow_pose(side: str, **kw):
    kw.setdefault("other_elbow_deg", 175.0)
    return lambda deg: side_view_pose(side, elbow_deg=deg, **kw)


def neck_pose(side: str, **kw):
    sign = 1.0 if side == "left" else -1.0
    return lambda deg: front_view_pose(neck_tilt_deg=sign * deg, **kw)


#: slug -> (builder factory, rest value, clean peak value)
CASES = {
    "trunk-flexion": (trunk_pose, 0.0, 70.0),
    "neck-side-bend": (neck_pose, 0.0, 35.0),
    "knee-extension": (knee_ext_pose, 90.0, 175.0),
    "standing-hip-extension": (hip_ext_pose, 0.0, 25.0),
    "elbow-extension": (elbow_pose, 70.0, 175.0),
}

SIDES = ("left", "right")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_fixture_contains_all_five_exercises():
    assert set(CONFIGS) == set(CASES)
    for slug in CASES:
        assert is_supported(slug)


@pytest.mark.parametrize("slug", sorted(CASES))
def test_side_is_required(slug):
    with pytest.raises(ValueError, match="side"):
        make(slug, None)


@pytest.mark.parametrize("slug", sorted(CASES))
@pytest.mark.parametrize("side", SIDES)
def test_side_is_substituted_everywhere(slug, side):
    analyzer = make(slug, side.upper())
    config = analyzer.config
    other = "right" if side == "left" else "left"
    assert config.side == side.upper()

    blob = json.dumps(
        {
            "landmarks": [lm.value for lm in config.required_landmarks],
            "angles": config.angle_definitions,
            "rules": list(config.posture_rules),
            "cues": dict(config.cues),
        }
    )
    assert "{side}" not in blob and "{other}" not in blob
    assert "{Side}" not in blob and "{SIDE}" not in blob
    # Side-view exercises require only the selected side (and the nose): the
    # far side is partly hidden and must never be what blocks analysis. The
    # front-view neck exercise legitimately needs both eyes and shoulders.
    if slug != "neck-side-bend":
        for lm in config.required_landmarks:
            assert not lm.value.startswith(other), (slug, side, lm.value)


def test_existing_exercise_configs_need_no_side():
    """Exercises written without placeholders are untouched by templating."""
    payload = {
        "exerciseSlug": "bicep-curl",
        "requiredLandmarks": ["left_elbow"],
        "angleDefinitions": {"x": {"type": "joint", "a": "left_shoulder", "b": "left_elbow", "c": "left_wrist"}},
        "movementStateConfig": {"primaryAngle": "x", "direction": "DECREASING", "restAngle": 150, "peakAngle": 60},
        "postureRules": [],
    }
    config = RuleConfig.from_payload(payload)
    assert config.side is None


# ---------------------------------------------------------------------------
# Repetition counting - every exercise, both sides
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slug", sorted(CASES))
@pytest.mark.parametrize("side", SIDES)
def test_complete_cycles_each_count_once(slug, side):
    factory, rest, peak = CASES[slug]
    runner = Runner(make(slug, side.upper()))
    run_cycles(runner, cycle(factory(side), rest, peak), times=3)
    assert runner.reps == 3, (runner.errors, runner.messages[-3:])
    assert ErrorCode.WRONG_CAMERA_VIEW not in runner.errors
    assert ErrorCode.WRONG_SIDE_FACING not in runner.errors


@pytest.mark.parametrize("slug", sorted(CASES))
def test_partial_movement_counts_nothing(slug):
    factory, rest, peak = CASES[slug]
    config = CONFIGS[slug]["ruleConfig"]["movementStateConfig"]
    # Stop clearly short of the peak band.
    short = config["peakAngle"] - (config["peakAngle"] - config["restAngle"]) * 0.35
    runner = Runner(make(slug, "LEFT"))
    run_cycles(runner, cycle(factory("left"), rest, short), times=3)
    assert runner.reps == 0


@pytest.mark.parametrize("slug", sorted(CASES))
def test_jitter_at_rest_counts_nothing(slug):
    factory, rest, _ = CASES[slug]
    build = factory("left")
    runner = Runner(make(slug, "LEFT"))
    for i in range(80):
        runner.feed(build(rest + (3.0 if i % 2 else -3.0)))
    assert runner.reps == 0


@pytest.mark.parametrize("slug", sorted(CASES))
def test_movement_cues_are_exercise_specific(slug):
    factory, rest, peak = CASES[slug]
    runner = Runner(make(slug, "RIGHT"))
    run_cycles(runner, cycle(factory("right"), rest, peak))
    cues = CONFIGS[slug]["ruleConfig"]["movementStateConfig"]["cues"]
    seen = set(runner.guidance)
    assert any("complete" in cue.lower() for cue in seen)
    assert any("return" in cue.lower() for cue in seen)
    # Side-specific wording was resolved, never shown raw.
    assert not any("{" in cue for cue in seen)
    assert set(cues)  # every exercise defines cues


# ---------------------------------------------------------------------------
# Camera orientation gates
# ---------------------------------------------------------------------------

SIDE_VIEW = ("trunk-flexion", "knee-extension", "standing-hip-extension", "elbow-extension")


@pytest.mark.parametrize("slug", SIDE_VIEW)
def test_facing_the_camera_pauses_side_view_exercises(slug):
    """Shoulders wide apart = facing the camera. A full cycle counts nothing."""
    factory, rest, peak = CASES[slug]
    runner = Runner(make(slug, "LEFT"))
    run_cycles(runner, cycle(factory("left", shoulder_spread=150.0), rest, peak), times=2)
    assert runner.reps == 0
    assert ErrorCode.WRONG_CAMERA_VIEW in runner.errors
    assert not runner.last.tracking_valid
    assert runner.last.guidance is None


@pytest.mark.parametrize("slug", SIDE_VIEW)
def test_wrong_side_towards_camera_pauses_counting(slug):
    """The selected side is the hidden one: YOLO is more confident about the
    OTHER side. Counting pauses and the message names the selected side."""
    factory, rest, peak = CASES[slug]
    runner = Runner(make(slug, "RIGHT"))
    build = factory("right", near_confidence=0.6, far_confidence=0.95)
    run_cycles(runner, cycle(build, rest, peak), times=2)
    assert runner.reps == 0
    assert ErrorCode.WRONG_SIDE_FACING in runner.errors
    assert any("right side must face the camera" in m for m in runner.messages)


@pytest.mark.parametrize("slug", SIDE_VIEW)
def test_counting_resumes_once_repositioned(slug):
    factory, rest, peak = CASES[slug]
    runner = Runner(make(slug, "LEFT"))
    run_cycles(runner, cycle(factory("left", shoulder_spread=150.0), rest, peak))
    assert runner.reps == 0
    run_cycles(runner, cycle(factory("left"), rest, peak), times=2)
    assert runner.reps == 2


def test_side_view_works_facing_either_way():
    for facing in (1, -1):
        runner = Runner(make("trunk-flexion", "LEFT"))
        run_cycles(runner, cycle(trunk_pose("left", facing=facing), 0.0, 70.0), times=2)
        assert runner.reps == 2, facing


def test_side_on_neck_exercise_is_paused():
    runner = Runner(make("neck-side-bend", "LEFT"))
    run_cycles(runner, cycle(neck_pose("left", half_shoulder=10.0), 0.0, 35.0))
    assert runner.reps == 0
    assert ErrorCode.WRONG_CAMERA_VIEW in runner.errors


# ---------------------------------------------------------------------------
# Left / right independence
# ---------------------------------------------------------------------------


def test_knee_extension_counts_only_the_selected_leg():
    runner = Runner(make("knee-extension", "LEFT"))
    # The LEFT (selected) leg stays bent while the right leg does the work.
    def build(deg):
        return side_view_pose(
            "left", hip_flexion_deg=90.0, knee_deg=90.0, other_knee_deg=deg
    )
    run_cycles(runner, cycle(build, 90.0, 175.0), times=2)
    assert runner.reps == 0
    assert ErrorCode.WRONG_SIDE_MOVEMENT in runner.errors
    assert any("right leg is straightening" in m for m in runner.messages)


def test_elbow_extension_counts_only_the_selected_arm():
    runner = Runner(make("elbow-extension", "RIGHT"))
    def build(deg):
        return side_view_pose("right", elbow_deg=175.0, other_elbow_deg=deg)
    run_cycles(runner, cycle(build, 175.0, 70.0), times=2)
    assert runner.reps == 0
    assert ErrorCode.WRONG_SIDE_MOVEMENT in runner.errors


def test_hip_extension_counts_only_the_selected_leg():
    runner = Runner(make("standing-hip-extension", "LEFT"))
    def build(deg):
        return side_view_pose("left", hip_flexion_deg=0.0, other_hip_flexion_deg=-deg)
    run_cycles(runner, cycle(build, 0.0, 25.0), times=2)
    assert runner.reps == 0
    assert ErrorCode.WRONG_SIDE_MOVEMENT in runner.errors


def test_neck_bend_the_other_way_counts_nothing():
    runner = Runner(make("neck-side-bend", "LEFT"))
    # Tilting towards the RIGHT shoulder during a LEFT session.
    run_cycles(runner, cycle(neck_pose("right"), 0.0, 35.0), times=2)
    assert runner.reps == 0
    assert ErrorCode.WRONG_SIDE_MOVEMENT in runner.errors
    assert any("right shoulder" in m for m in runner.messages)


def test_left_and_right_sessions_are_independent():
    left = Runner(make("knee-extension", "LEFT"))
    right = Runner(make("knee-extension", "RIGHT"))
    run_cycles(left, cycle(knee_ext_pose("left"), 90.0, 175.0), times=3)
    run_cycles(right, cycle(knee_ext_pose("right"), 90.0, 175.0), times=1)
    assert (left.reps, right.reps) == (3, 1)


# ---------------------------------------------------------------------------
# Exercise-specific posture feedback
# ---------------------------------------------------------------------------


def test_neck_whole_body_lean_is_not_neck_movement():
    runner = Runner(make("neck-side-bend", "LEFT"))
    # The whole upper body leans 15 deg, head included: no neck bend at all.
    def build(deg):
        return front_view_pose(body_lean_deg=deg)
    run_cycles(runner, cycle(build, 0.0, 15.0))
    assert runner.reps == 0
    assert abs(runner.last.angles["neckTilt"]) < 1.0
    # ...and the patient is told to keep the torso still.
    assert ErrorCode.TRUNK_COMPENSATION in runner.errors
    assert any("bend only your neck" in m for m in runner.messages)


def test_neck_shoulder_hike_is_flagged():
    runner = Runner(make("neck-side-bend", "LEFT"))
    runner.feed(front_view_pose(neck_tilt_deg=20.0, shoulder_hike_px=25.0), 10)
    assert ErrorCode.SHOULDER_HITCH in runner.errors
    assert any("shoulders relaxed" in m for m in runner.messages)


def test_knee_extension_incomplete_extension():
    runner = Runner(make("knee-extension", "LEFT"))
    run_cycles(runner, cycle(knee_ext_pose("left"), 90.0, 160.0))
    assert runner.reps == 1
    assert any("Extend your knee fully" in m for m in runner.messages)


def test_hip_extension_ignores_forward_lean_and_flags_it():
    """Leaning forward must not fake hip extension: the thigh is measured
    against the trunk line, not against gravity."""
    runner = Runner(make("standing-hip-extension", "LEFT"))
    # Trunk leans 30 deg forward, thigh stays in line with the trunk.
    lean = side_view_pose("left", trunk_deg=30.0, hip_flexion_deg=0.0)
    runner.feed(lean, 15)
    assert abs(runner.last.angles["hipExtension"]) < 1.0
    assert runner.reps == 0
    assert ErrorCode.TRUNK_LEAN in runner.errors


def test_hip_extension_knee_bend_is_flagged():
    runner = Runner(make("standing-hip-extension", "RIGHT"))
    runner.feed(side_view_pose("right", hip_flexion_deg=-20.0, knee_deg=100.0), 10)
    assert ErrorCode.KNEE_FLEXED in runner.errors


def test_elbow_extension_shoulder_movement_is_flagged():
    runner = Runner(make("elbow-extension", "LEFT"))
    runner.feed(side_view_pose("left", elbow_deg=120.0, upper_arm_deg=45.0), 10)
    assert ErrorCode.EXCESSIVE_MOVEMENT in runner.errors
    assert any("Excessive shoulder movement" in m for m in runner.messages)


def test_trunk_flexion_knee_bend_and_backward_lean():
    runner = Runner(make("trunk-flexion", "LEFT"))
    runner.feed(side_view_pose("left", trunk_deg=40.0, knee_deg=120.0), 10)
    assert ErrorCode.KNEE_FLEXED in runner.errors
    back = Runner(make("trunk-flexion", "LEFT"))
    back.feed(side_view_pose("left", trunk_deg=-25.0), 10)
    assert ErrorCode.TRUNK_LEAN in back.errors
    assert back.reps == 0


def test_internal_measurements_are_not_reported_as_angles():
    runner = Runner(make("knee-extension", "LEFT"))
    result = runner.feed(knee_ext_pose("left")(120.0), 6)
    assert "knee" in result.angles
    assert not any(name.startswith("_") for name in result.angles)


def test_missing_landmark_pauses_counting():
    runner = Runner(make("elbow-extension", "LEFT"))

    def build(deg):
        pose = side_view_pose("left", elbow_deg=deg)
        pixels = dict(pose.pixels)
        pixels[Landmark.LEFT_WRIST] = Keypoint(x=0, y=0, confidence=0.1)
        return PoseFrame(pixels=pixels, normalized=pose.normalized, width=FRAME_W, height=FRAME_H)

    run_cycles(runner, cycle(build, 70.0, 175.0), times=2)
    assert runner.reps == 0
    assert ErrorCode.PARTIAL_BODY_VISIBLE in runner.errors
