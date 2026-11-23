import {
  CameraView,
  Difficulty,
  ExerciseGoalType,
  ExerciseSideMode,
} from '@prisma/client';

/**
 * The exercise library and its computer-vision rule configurations.
 *
 * ============================ IMPORTANT ============================
 * Every threshold below is a PROTOTYPE DEMONSTRATION VALUE.
 *
 * They are taken from the project's own YOLOv8 analyzers in
 * `FYP/FYP/physio_backend/analysis/` - one file per exercise - and each is
 * annotated with the line it came from. They are NOT clinical standards, they
 * have NOT been validated by a physiotherapist, and they must not be described
 * as either.
 *
 * That is exactly why they live here as data rather than in Python source: a
 * qualified physiotherapist can revise them without touching the analysis code,
 * and each session records which rule VERSION judged it, so a later change
 * cannot silently rewrite a historical report.
 * ===================================================================
 *
 * Units
 * -----
 * ANGLES are degrees, computed in the image plane from YOLOv8's 2-D keypoints.
 *
 * DISTANCES (`gap_x`, `gap_y`) are pixels in a 640-wide reference frame. The
 * prototype ran `cv2.VideoCapture(0)`, which opens at 640x480, so its pixel
 * thresholds - `elbow_drift > 40`, `shoulder_diff > 20` - are distances in a
 * 640-wide image. The browser here sends 480-wide frames, and the pose service
 * rescales every distance into the 640 reference before comparing, so these
 * numbers keep the meaning they were tuned with. See PIXEL_REFERENCE_WIDTH in
 * services/pose-service/app/geometry/angles.py.
 *
 * RATIOS are dimensionless.
 *
 * Single-limb combining
 * ---------------------
 * The prototype averaged left and right for every exercise. That is correct
 * for a squat, where both knees flex together, and WRONG for anything
 * performed one limb at a time: one arm curled to 50 degrees beside one
 * resting at 170 averages to 110, which never crosses a 60-degree threshold,
 * so no repetition can ever complete. Single-limb exercises therefore use
 * `min` (for a DECREASING angle) or `max` (for an INCREASING one). The
 * thresholds are unchanged; only the choice of which limb drives the state
 * machine differs.
 *
 * Camera-view honesty
 * -------------------
 * Single-camera pose estimation is strongly view-dependent, and YOLOv8 returns
 * no depth at all, so each exercise declares the view its rules were written
 * for and only rules measurable from that view are included.
 */

export interface RuleConfigSeed {
  version: number;
  requiredLandmarks: string[];
  angleDefinitions: Record<string, Record<string, unknown>>;
  /**
   * Thresholds for the repetition state machine.
   *
   * Omitted by HOLD exercises, which have no movement cycle to describe. The
   * pose service rejects a missing config for a REPS exercise rather than
   * defaulting one, so this cannot be forgotten by accident.
   */
  movementStateConfig?: Record<string, unknown>;
  postureRules: Record<string, unknown>[];
  minVisibility: number;
  repCorrectnessThreshold: number;
}

export interface ExerciseSeed {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  category: string;
  difficulty: Difficulty;
  targetBodyArea: string;
  recommendedView: CameraView;
  framingInstructions: string;
  defaultSets: number;
  defaultReps: number;
  /**
   * REPS for a countable movement; HOLD for a sustained position.
   *
   * A HOLD exercise still carries defaultSets/defaultReps because the
   * assignment columns are not nullable, but neither number means anything to
   * it - `defaultHoldSeconds` is its prescription.
   */
  goalType?: ExerciseGoalType;
  defaultHoldSeconds?: number;
  /**
   * NONE (default) for exercises without a left/right choice. Anything else
   * makes the patient choose a side, and the rule config is then written with
   * `{side}` / `{other}` placeholders - see "Side-specific exercises" below.
   */
  sideMode?: ExerciseSideMode;
  isActive: boolean;
  ruleConfig?: RuleConfigSeed;
}

// ===========================================================================
// Side-specific exercises - shared building blocks
// ===========================================================================
//
// Placeholders. A side-specific rule config is written once with these, and
// the pose service substitutes the side the patient selected when the session
// starts (services/pose-service/app/exercises/base.py, _apply_side):
//
//   {side} / {other}   -> left / right       landmark names, e.g. {side}_knee
//   {Side} / {Other}   -> Left / Right       patient-facing text
//   {SIDE} / {OTHER}   -> LEFT / RIGHT
//
// Every landmark, angle and message in a session therefore comes from the one
// side that was selected; nothing in the analysis picks a side on its own,
// which is what rules out left/right mix-ups.
//
// Names beginning with "_" are internal measurements (ratios, confidence
// gaps) that rules test but the patient is never shown.
//
// Gates. A posture rule with `gate: true` is a FRAMING check. When it fails,
// the frame is treated like one with missing landmarks: the repetition state
// machine is frozen and a warning is shown, so a movement performed from the
// wrong camera angle can never be counted. Counting resumes on its own once
// the patient is positioned correctly.

/**
 * Side-view check: the two shoulders should sit almost on top of each other.
 *
 * Shoulder width is compared with torso LENGTH (not height), so the check is
 * independent of how far the patient stands from the camera and does not
 * trip when they bend forward. Facing the camera reads roughly 0.7-1.0;
 * side-on reads roughly 0.0-0.3; 0.45 sits between a 45-degree turn and true
 * side-on.
 */
function sideViewMeasures(): Record<string, Record<string, unknown>> {
  return {
    _shoulderWidth: { type: 'gap_x', a: 'left_shoulder', b: 'right_shoulder' },
    _torsoLength: { type: 'distance', a: '{side}_shoulder', b: '{side}_hip' },
    _frontalRatio: {
      type: 'ratio',
      numerator: '_shoulderWidth',
      denominator: '_torsoLength',
    },
    // Side-on, the half of the body nearer the camera is seen clearly and the
    // far half is partly hidden behind it, so YOLO is markedly more confident
    // about the near side. Positive here means the OTHER side is the clearer
    // one - the patient has turned the wrong way.
    _facingGap: {
      type: 'confidence_gap',
      subject: ['{side}_shoulder', '{side}_hip', '{side}_knee'],
      other: ['{other}_shoulder', '{other}_hip', '{other}_knee'],
    },
  };
}

function sideViewGates(what: string): Record<string, unknown>[] {
  return [
    {
      gate: true,
      code: 'WRONG_CAMERA_VIEW',
      angle: '_frontalRatio',
      max: 0.45,
      message:
        'Incorrect camera position - stand side-on, with your {side} shoulder pointing at the camera. Counting is paused.',
    },
    {
      gate: true,
      code: 'WRONG_SIDE_FACING',
      angle: '_facingGap',
      max: 0.2,
      message: `Turn around - your {side} side must face the camera for the ${what}. Counting is paused.`,
    },
  ];
}

export const EXERCISE_SEEDS: ExerciseSeed[] = [
  // =======================================================================
  // analysis/squat.py -> SquatAnalyzer
  // =======================================================================
  {
    slug: 'squat',
    name: 'Bodyweight Squat',
    description:
      'A closed-chain lower-limb exercise that loads the quadriceps, glutes and hamstrings together, commonly used to rebuild functional leg strength.',
    instructions:
      'Stand with your feet about shoulder-width apart. Lower your hips as if sitting into a chair, keeping your heels flat and your chest lifted. Pause briefly, then push through your heels to return to standing.',
    category: 'Lower Body',
    difficulty: Difficulty.MEDIUM,
    targetBodyArea: 'Knee, hip',
    // SIDE, and this is not a preference - it is the only view the movement
    // can be measured from.
    //
    // A squat is a SAGITTAL-plane movement: the knee bends forwards. The
    // thresholds below (rest 160 deg, peak 120 deg) are knee-flexion angles
    // carried over from squat.py, which analysed side-on footage.
    //
    // Face-on, the hip, knee and ankle stay almost vertically stacked in the
    // image however deep the squat is, because the knee travels TOWARDS the
    // camera and that motion is along the axis a 2-D pose estimate cannot
    // see. Measured from the front, a full squat reads about 165-178 deg - a
    // swing of roughly 10 deg, most of it inside the noise of the estimate,
    // and never anywhere near the 120 deg needed to count a repetition. A
    // patient squatting perfectly would score zero repetitions forever, which
    // is exactly what was reported.
    recommendedView: CameraView.SIDE,
    framingInstructions:
      'Stand SIDE-ON to the camera - one shoulder towards it, not your face - about 2-3 metres away, with your whole body from head to feet in frame. Keep your feet in shot the whole way down: the count pauses if your ankles leave the picture. Side-on is what lets the camera see your knee bend; facing it, the bend is hidden and nothing will count.',
    defaultSets: 3,
    defaultReps: 10,
    isActive: true,
    ruleConfig: {
      version: 2,
      requiredLandmarks: [
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle',
      ],
      angleDefinitions: {
        leftKnee: { type: 'joint', a: 'left_hip', b: 'left_knee', c: 'left_ankle' },
        rightKnee: { type: 'joint', a: 'right_hip', b: 'right_knee', c: 'right_ankle' },
        // AVERAGE. `min` was tried here and is worse: side-on the far leg is
        // occluded, and a single noisy frame reading it as bent drags the
        // minimum below the rest threshold and holds it there, so the cycle
        // never returns to UP and nothing is ever counted. The mean of the two
        // absorbs that noise instead of being captured by it.
        knee: { type: 'average', of: ['leftKnee', 'rightKnee'] },

        leftHip: { type: 'joint', a: 'left_shoulder', b: 'left_hip', c: 'left_knee' },
        rightHip: { type: 'joint', a: 'right_shoulder', b: 'right_hip', c: 'right_knee' },
        // Reported for the therapist. No rule tests it any more - see trunkTilt.
        hip: { type: 'average', of: ['leftHip', 'rightHip'] },

        // Trunk lean measured against GRAVITY rather than as a joint angle.
        // 0 deg is perfectly upright, 90 deg is folded horizontal.
        trunkTilt: { type: 'vertical', upper: 'mid_shoulder', lower: 'mid_hip' },
      },
      movementStateConfig: {
        primaryAngle: 'knee',
        direction: 'DECREASING',
        // squat.py _detect_state used >160 standing, 70-120 down. Both are
        // widened here, because those numbers assume a clean side-on angle
        // measurement and a 2-D pose estimate consistently UNDER-reads knee
        // flexion - the far leg is occluded and the median filter trims the
        // extremes of the descent.
        //
        // Loosened after patient testing found the squat too demanding.
        // peak 140 (was 130) is a comfortable partial squat - still a clear
        // bend, not a token dip. rest 152 (was 155) means the patient does
        // not have to straighten fully between repetitions. Hysteresis 4
        // (was 8) keeps the bands from overlapping at the narrower spacing;
        // the dwell, cooldown and minimum repetition time still reject
        // jitter. A shallower dip (~145 deg) deliberately does not count.
        restAngle: 152,
        peakAngle: 140,
        hysteresisDeg: 4,
        minStateFrames: 2,
        cooldownMs: 600,
        minRepDurationMs: 800,
        maxRepDurationMs: 20000,
      },
      postureRules: [
        {
          // squat.py: not (70 <= knee <= 120) while down -> "Adjust squat depth".
          // The upper bound is already the peak threshold, so what remains to
          // detect is going too deep.
          code: 'EXCESSIVE_DEPTH',
          angle: 'knee',
          when: 'at_peak',
          min: 70,
          joint: 'knee',
        },
        {
          // "Keep your back straight", but measured against gravity.
          //
          // This used to test the shoulder-hip-knee JOINT angle against a
          // minimum of 150 deg, carried over from squat.py. That is impossible
          // to satisfy while squatting: the hip is a hinge, and closing it is
          // how the movement happens. Standing reads about 175 deg, a squat to
          // parallel reads about 90 deg even with a perfectly vertical back -
          // so the rule fired on every correct repetition and told the patient
          // to straighten up while they were doing exactly the right thing.
          //
          // What "leaning too far forward" actually means is the TRUNK tipping
          // away from vertical, which is independent of how deep the hip is
          // folded. 55 deg is deliberately generous: a bodyweight squat
          // normally leans 20-45 deg, so this flags only a genuine fold.
          code: 'TRUNK_LEAN',
          angle: 'trunkTilt',
          when: 'always',
          max: 55,
          joint: 'hip',
        },
        // The knee-alignment (valgus) check from squat.py is deliberately NOT
        // here any more. It compared knee separation against ankle separation,
        // and both are FRONTAL-plane measurements: side-on the two knees sit
        // one behind the other, so the widths collapse towards zero and the
        // ratio becomes meaningless - noise divided by noise, firing at random
        // and marking down repetitions that were performed correctly.
        //
        // It cannot be salvaged from this camera angle. Detecting knee valgus
        // properly needs a face-on view, which is the one the depth
        // measurement cannot use - so it belongs to a separate front-facing
        // assessment, not to this exercise.
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },

  // =======================================================================
  // analysis/bicep_curl.py -> BicepCurlAnalyzer
  // =======================================================================
  {
    slug: 'bicep-curl',
    name: 'Bicep Curl',
    description:
      'An isolated elbow-flexion exercise for rebuilding upper-arm strength and control after immobilisation.',
    instructions:
      'Stand tall with your arm hanging straight down and your upper arm still against your side. Bend your elbow to bring your hand up towards your shoulder, then lower it under control until your arm is straight again. One arm at a time is fine.',
    category: 'Upper Body',
    difficulty: Difficulty.EASY,
    targetBodyArea: 'Elbow, upper arm',
    recommendedView: CameraView.FRONT,
    framingInstructions:
      'Stand facing the camera, about 2 metres away, with your shoulder, elbow, wrist AND hip all in frame. Straighten your arm fully at the bottom of every repetition - the counter needs to see the arm reach full extension before it will count the next one.',
    defaultSets: 3,
    defaultReps: 12,
    isActive: true,
    ruleConfig: {
      version: 2,
      requiredLandmarks: [
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist',
      ],
      angleDefinitions: {
        leftElbow: { type: 'joint', a: 'left_shoulder', b: 'left_elbow', c: 'left_wrist' },
        rightElbow: { type: 'joint', a: 'right_shoulder', b: 'right_elbow', c: 'right_wrist' },
        // MIN, not the prototype's average. A curl is usually performed one
        // arm at a time; averaging a curled arm with a resting one produces a
        // value that never reaches the peak threshold. See the header note.
        elbow: { type: 'min', of: ['leftElbow', 'rightElbow'] },

        // bicep_curl.py: abs(elbow.x - shoulder.x) > 40 -> "Keep elbow fixed".
        leftDrift: { type: 'gap_x', a: 'left_elbow', b: 'left_shoulder' },
        rightDrift: { type: 'gap_x', a: 'right_elbow', b: 'right_shoulder' },
        elbowDrift: { type: 'max', of: ['leftDrift', 'rightDrift'] },
      },
      movementStateConfig: {
        primaryAngle: 'elbow',
        direction: 'DECREASING',
        // bicep_curl.py _detect_state: >150 open, <60 curl.
        restAngle: 150,
        peakAngle: 60,
        hysteresisDeg: 10,
        minStateFrames: 2,
        cooldownMs: 500,
        minRepDurationMs: 700,
        maxRepDurationMs: 15000,
      },
      postureRules: [
        {
          // bicep_curl.py: elbow_angle > 120 while curled -> "Move through full range".
          code: 'INCOMPLETE_ROM',
          angle: 'elbow',
          when: 'at_peak',
          max: 120,
          joint: 'elbow',
        },
        {
          // bicep_curl.py: elbow_drift > 40 -> "Keep elbow fixed".
          code: 'ELBOW_DRIFT',
          angle: 'elbowDrift',
          when: 'always',
          max: 40,
          joint: 'elbow',
        },
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },

  // =======================================================================
  // analysis/shoulder_abduction.py -> ShoulderAbductionAnalyzer
  // =======================================================================
  {
    slug: 'shoulder-abduction',
    name: 'Shoulder Abduction',
    description:
      'Lifting the arm sideways away from the body, used to restore shoulder range of motion and deltoid control after injury or immobilisation.',
    instructions:
      'Stand tall with your arms at your sides. Raise your arm out sideways until it is roughly level with your shoulder, keeping your elbow straight and your body still. Lower it slowly back to your side.',
    category: 'Upper Body',
    difficulty: Difficulty.EASY,
    targetBodyArea: 'Shoulder',
    recommendedView: CameraView.FRONT,
    framingInstructions:
      'Stand facing the camera, 2-3 metres away, with both shoulders, both elbows and both hips in frame. Keep your torso upright and still - leaning to the other side to lift higher is what the posture rules look for.',
    defaultSets: 3,
    defaultReps: 12,
    isActive: true,
    ruleConfig: {
      version: 1,
      requiredLandmarks: [
        'left_hip', 'right_hip',
        'left_shoulder', 'right_shoulder',
        'left_elbow', 'right_elbow',
      ],
      angleDefinitions: {
        leftShoulder: { type: 'joint', a: 'left_hip', b: 'left_shoulder', c: 'left_elbow' },
        rightShoulder: { type: 'joint', a: 'right_hip', b: 'right_shoulder', c: 'right_elbow' },
        // MAX: the raised arm drives the movement. This angle INCREASES, so
        // max is the single-limb equivalent of min on a curl.
        shoulder: { type: 'max', of: ['leftShoulder', 'rightShoulder'] },

        // shoulder_abduction.py: hip_tilt > 25 or shoulder_tilt > 20
        //   -> "Maintain posture".
        shoulderTilt: { type: 'gap_y', a: 'left_shoulder', b: 'right_shoulder' },
        hipTilt: { type: 'gap_y', a: 'left_hip', b: 'right_hip' },
      },
      movementStateConfig: {
        primaryAngle: 'shoulder',
        direction: 'INCREASING',
        // shoulder_abduction.py _detect_state: <30 down, >90 raised.
        restAngle: 30,
        peakAngle: 90,
        hysteresisDeg: 8,
        minStateFrames: 2,
        cooldownMs: 500,
        minRepDurationMs: 700,
        maxRepDurationMs: 15000,
      },
      postureRules: [
        {
          // shoulder_abduction.py: shoulder < 80 while raised -> "Raise arm properly".
          code: 'INCOMPLETE_ROM',
          angle: 'shoulder',
          when: 'at_peak',
          min: 80,
          joint: 'shoulder',
        },
        {
          code: 'SHOULDER_HITCH',
          angle: 'shoulderTilt',
          when: 'always',
          max: 20,
          joint: 'shoulder',
        },
        {
          code: 'TRUNK_COMPENSATION',
          angle: 'hipTilt',
          when: 'always',
          max: 25,
          joint: 'hip',
        },
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },

  // =======================================================================
  // analysis/straight_leg_raise.py -> StraightLegRaiseAnalyzer
  // =======================================================================
  {
    slug: 'straight-leg-raise',
    name: 'Straight Leg Raise',
    description:
      'Lifting the whole leg with the knee locked straight, a standard early-stage quadriceps exercise after knee surgery.',
    instructions:
      'Lie on your back with one leg bent and the other straight. Tighten the thigh muscle of the straight leg, then lift it slowly until it is roughly level with the bent knee. Hold briefly and lower it under control. Keep the knee locked straight throughout.',
    category: 'Lower Body',
    difficulty: Difficulty.EASY,
    targetBodyArea: 'Knee, hip',
    recommendedView: CameraView.SIDE,
    framingInstructions:
      'Lie side-on to the camera with the whole body in frame from shoulder to ankle - place the camera on the floor or a low chair 2-3 metres away. The working leg must be the one nearer the camera.',
    defaultSets: 3,
    defaultReps: 10,
    isActive: true,
    ruleConfig: {
      version: 1,
      requiredLandmarks: [
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle',
      ],
      angleDefinitions: {
        leftHip: { type: 'joint', a: 'left_shoulder', b: 'left_hip', c: 'left_knee' },
        rightHip: { type: 'joint', a: 'right_shoulder', b: 'right_hip', c: 'right_knee' },
        // MAX: the raised leg drives the movement, and the hip angle increases
        // as it lifts. The other leg is deliberately bent in this exercise, so
        // averaging would halve the reading and stop reps counting.
        hip: { type: 'max', of: ['leftHip', 'rightHip'] },

        leftKnee: { type: 'joint', a: 'left_hip', b: 'left_knee', c: 'left_ankle' },
        rightKnee: { type: 'joint', a: 'right_hip', b: 'right_knee', c: 'right_ankle' },
        // MAX again, and for a specific reason: the resting leg is SUPPOSED to
        // be bent. Taking the straighter of the two means the rule fires only
        // when neither leg is extended, which errs towards not penalising a
        // patient for the leg they were told to bend. The cost is that a
        // bending working leg can be missed while the resting leg is straight.
        knee: { type: 'max', of: ['leftKnee', 'rightKnee'] },
      },
      movementStateConfig: {
        primaryAngle: 'hip',
        direction: 'INCREASING',
        // straight_leg_raise.py _detect_state: <30 rest, >45 raised.
        restAngle: 30,
        peakAngle: 45,
        hysteresisDeg: 6,
        minStateFrames: 2,
        cooldownMs: 600,
        minRepDurationMs: 900,
        maxRepDurationMs: 20000,
      },
      postureRules: [
        {
          // straight_leg_raise.py: knee_angle < 160 -> "Keep knee straight".
          code: 'KNEE_FLEXED',
          angle: 'knee',
          when: 'always',
          min: 160,
          joint: 'knee',
        },
        {
          // straight_leg_raise.py: raised and hip < 50 -> "Lift slowly".
          code: 'INCOMPLETE_ROM',
          angle: 'hip',
          when: 'at_peak',
          min: 50,
          joint: 'hip',
        },
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },

  // =======================================================================
  // analysis/posture.py -> PostureAnalyzer
  // =======================================================================
  {
    slug: 'static-posture',
    name: 'Postural Correction',
    description:
      'A standing postural drill. Rather than counting repetitions, it measures how long you can hold a tall, level, correctly aligned stance: shoulder level, hip level and spine alignment are assessed continuously and corrected as you go.',
    instructions:
      'Stand facing the camera with your feet level and hold a tall stance: lengthen through the spine, level your shoulders and keep your hips even. Follow the on-screen guidance to correct your alignment. The timer runs only while your posture is correct, and the session finishes on its own once you have held it long enough in total - you do not have to hold it all in one go.',
    category: 'Posture',
    difficulty: Difficulty.EASY,
    targetBodyArea: 'Spine, shoulders, hips',
    recommendedView: CameraView.FRONT,
    framingInstructions:
      'Stand facing the camera, 2-3 metres away, with both shoulders, both hips and both knees in frame. Stand square to the camera - a rotated torso reads as uneven shoulders.',
    // Sets and reps are meaningless here and are never shown for a HOLD
    // exercise; they exist only because the assignment columns are NOT NULL.
    defaultSets: 1,
    defaultReps: 1,
    goalType: ExerciseGoalType.HOLD,
    // PROTOTYPE DEFAULT requiring physiotherapist review, exactly like every
    // angle threshold in this file.
    defaultHoldSeconds: 60,
    isActive: true,
    ruleConfig: {
      // v2: the invented repetition cycle removed, SPINE_ALIGNMENT moved to
      // `always`. Sessions judged under v1 keep their recorded version, so
      // their reports still describe what actually happened.
      version: 2,
      requiredLandmarks: [
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
      ],
      angleDefinitions: {
        // posture.py _spine_angle: angle at the hip midpoint between the
        // shoulder midpoint and the knee. 180 degrees is perfectly upright.
        spine: { type: 'joint', a: 'mid_shoulder', b: 'mid_hip', c: 'mid_knee' },
        // posture.py: abs(left.y - right.y) for shoulders and hips.
        shoulderAlignment: { type: 'gap_y', a: 'left_shoulder', b: 'right_shoulder' },
        hipAlignment: { type: 'gap_y', a: 'left_hip', b: 'right_hip' },
      },
      // NO movementStateConfig. The prototype's PostureAnalyzer counts no
      // repetitions - it scores every frame as correct or incorrect and
      // nothing else - and neither does this.
      //
      // An earlier version of this seed invented a "correction cycle" here:
      // slouch below 150 degrees, straighten past 170, call that one rep. It
      // produced a number, but the number was perverse - the only way to score
      // a second repetition was to first undo the first one, and a patient who
      // simply stood correctly for two minutes scored zero. The goal is now
      // seconds held in correct alignment (goalType HOLD), which is what the
      // exercise is actually for.
      postureRules: [
        {
          // posture.py SHOULDER_THRESHOLD = 20.0
          code: 'SHOULDER_ALIGNMENT',
          angle: 'shoulderAlignment',
          when: 'always',
          max: 20,
          joint: 'shoulder',
        },
        {
          // posture.py HIP_THRESHOLD = 20.0
          code: 'HIP_ALIGNMENT',
          angle: 'hipAlignment',
          when: 'always',
          max: 20,
          joint: 'hip',
        },
        {
          // posture.py SPINE_THRESHOLD = 15.0, applied as abs(180 - spine).
          // A joint angle cannot exceed 180, so the deviation only ever falls
          // below - which makes this a simple lower bound at 165.
          //
          // `always`, not `at_peak`: with no movement cycle there is no peak,
          // and this is the rule that tells the patient to straighten up. It
          // is the exercise's primary piece of guidance, so it has to be
          // evaluated on every frame.
          code: 'SPINE_ALIGNMENT',
          angle: 'spine',
          when: 'always',
          min: 165,
          joint: 'spine',
        },
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },
  // =======================================================================
  // SIDE-SPECIFIC EXERCISES
  //
  // Unlike the five above, these are not ported from a prototype analyzer:
  // they were added later and their thresholds are PROTOTYPE DEMONSTRATION
  // VALUES chosen from typical range-of-motion figures and the limits of a
  // 2-D camera. Like everything in this file they require review by a
  // qualified physiotherapist before any clinical use.
  //
  // Each one counts repetitions with the same MovementMachine as the rest:
  // a rest band, a peak band, hysteresis, a minimum dwell, a cooldown and
  // minimum/maximum repetition durations - so jitter around a threshold, a
  // half movement or a posture adjustment cannot be counted.
  // =======================================================================

  // -----------------------------------------------------------------------
  // Trunk Flexion - side view
  // -----------------------------------------------------------------------
  {
    slug: 'trunk-flexion',
    name: 'Trunk Flexion',
    description:
      'A standing forward bend from the hips, used to restore lower-back and hamstring mobility and controlled movement of the trunk.',
    instructions:
      'Stand tall with your feet hip-width apart and your knees straight but not locked. Slowly bend forward from your hips, letting your upper body tip towards the floor as far as is comfortable. Pause, then return to standing tall. Move slowly and do not bounce.',
    category: 'Spine',
    difficulty: Difficulty.EASY,
    targetBodyArea: 'Lower back, trunk, hips',
    // A forward bend is a sagittal-plane movement: from the front the trunk
    // tips TOWARDS the camera, which a 2-D estimate cannot see.
    recommendedView: CameraView.SIDE,
    framingInstructions:
      'Stand SIDE-ON to the camera, about 2-3 metres away, with your whole body from head to feet in frame. The side you select is the side that faces the camera - stand with that shoulder pointing at the lens. Counting pauses if you face the camera or turn the other way.',
    defaultSets: 2,
    defaultReps: 10,
    // The bend itself is symmetrical; the side chosen is the one nearer the
    // camera, whose shoulder, hip and knee the analysis reads.
    sideMode: ExerciseSideMode.FACING,
    isActive: true,
    ruleConfig: {
      version: 1,
      requiredLandmarks: [
        'nose',
        '{side}_shoulder', '{side}_hip', '{side}_knee', '{side}_ankle',
      ],
      angleDefinitions: {
        // Trunk angle measured from upright: 0 deg standing tall, positive
        // as the shoulders travel FORWARD of the hips, negative for a lean
        // backwards. Forward is read from the body itself (shoulder -> nose),
        // so it works whichever way the patient faces.
        trunkFlexion: {
          type: 'signed_tilt',
          pivot: '{side}_hip',
          end: '{side}_shoulder',
          reference: 'up',
          facing: ['{side}_shoulder', 'nose'],
          positive: 'forward',
        },
        knee: { type: 'joint', a: '{side}_hip', b: '{side}_knee', c: '{side}_ankle' },
        ...sideViewMeasures(),
      },
      movementStateConfig: {
        primaryAngle: 'trunkFlexion',
        direction: 'INCREASING',
        // Below 15 deg is standing; past 45 deg is a clear forward bend.
        // Posture adjustments and small sways stay inside the rest band
        // (plus 6 deg hysteresis) and are never counted.
        restAngle: 15,
        peakAngle: 45,
        hysteresisDeg: 6,
        minStateFrames: 3,
        cooldownMs: 800,
        minRepDurationMs: 1200,
        maxRepDurationMs: 20000,
        cues: {
          IDLE: 'Stand tall, {side} side towards the camera, to begin.',
          UP: 'Slowly bend forward from your hips.',
          GOING_DOWN: 'Keep bending forward - move further.',
          DOWN: 'Movement completed - now slowly return to standing.',
          GOING_UP: 'Return to the upright starting position.',
          REP: 'Repetition complete - stand tall before the next one.',
        },
      },
      postureRules: [
        {
          code: 'INCOMPLETE_ROM',
          angle: 'trunkFlexion',
          when: 'at_peak',
          min: 50,
          joint: 'trunk',
          message: 'Move further - bend a little more forward from your hips.',
        },
        {
          code: 'KNEE_FLEXED',
          angle: 'knee',
          when: 'always',
          min: 150,
          joint: 'knee',
          message:
            'Keep your knees almost straight - bend from your hips, not your knees.',
        },
        {
          code: 'TRUNK_LEAN',
          angle: 'trunkFlexion',
          when: 'always',
          min: -15,
          joint: 'trunk',
          message: 'Avoid leaning backwards - return only as far as upright.',
        },
        ...sideViewGates('forward bend'),
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },

  // -----------------------------------------------------------------------
  // Side Bend (Neck Lateral Flexion) - front view
  // -----------------------------------------------------------------------
  {
    slug: 'neck-side-bend',
    name: 'Side Bend (Neck Lateral Flexion)',
    description:
      'Tilting the head sideways, ear towards shoulder, to restore neck mobility and ease stiffness in the side of the neck.',
    instructions:
      'Stand or sit tall facing forward with your shoulders relaxed. Slowly tilt your head so your ear moves towards your shoulder on the side you selected, keeping your face pointing forward and your shoulders still. Pause, then bring your head back to the centre. Do not lift your shoulder to meet your ear.',
    category: 'Neck',
    difficulty: Difficulty.EASY,
    targetBodyArea: 'Neck',
    // Lateral flexion happens in the frontal plane, so it is only visible
    // face-on.
    recommendedView: CameraView.FRONT,
    framingInstructions:
      'FACE the camera, about 1.5-2 metres away, with your head, both shoulders and your hips in frame. Keep your face and both eyes clearly visible - no hat or hair over the eyes. Stand square to the camera; counting pauses if you turn side-on.',
    defaultSets: 2,
    defaultReps: 10,
    // Each session bends in ONE direction. Left and right are separate
    // sessions, so each direction keeps its own count and report.
    sideMode: ExerciseSideMode.DIRECTION,
    isActive: true,
    ruleConfig: {
      version: 1,
      requiredLandmarks: [
        'nose', 'left_eye', 'right_eye',
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
      ],
      angleDefinitions: {
        // Head tilt measured as the eye line against the SHOULDER line, not
        // against the horizontal. Leaning the whole body tilts both lines
        // together and cancels out, so only movement of the head on the
        // shoulders - the neck - is measured. Positive = towards the
        // selected side; negative = bending the other way.
        neckTilt: {
          type: 'line_tilt',
          a: 'right_eye',
          b: 'left_eye',
          refA: 'right_shoulder',
          refB: 'left_shoulder',
          towards: '{side}',
        },
        // Whole-body lean, for the "you are moving your torso" check.
        trunkTilt: { type: 'vertical', upper: 'mid_shoulder', lower: 'mid_hip' },

        _shoulderWidth: { type: 'gap_x', a: 'left_shoulder', b: 'right_shoulder' },
        _torsoLength: { type: 'distance', a: 'mid_shoulder', b: 'mid_hip' },
        _frontalRatio: {
          type: 'ratio',
          numerator: '_shoulderWidth',
          denominator: '_torsoLength',
        },
        // Shoulder elevation, as a fraction of shoulder width so it does not
        // depend on distance from the camera.
        _shoulderDrop: { type: 'gap_y', a: 'left_shoulder', b: 'right_shoulder' },
        _shoulderLevel: {
          type: 'ratio',
          numerator: '_shoulderDrop',
          denominator: '_shoulderWidth',
        },
      },
      movementStateConfig: {
        primaryAngle: 'neckTilt',
        direction: 'INCREASING',
        // Normal lateral flexion is roughly 35-45 deg, but on camera the
        // eye-line tilt reads lower than the true neck angle, and 25 deg
        // in practice demanded ear-to-shoulder. 15 deg is a clear tilt most
        // people can reach comfortably. Below 5 deg counts as upright.
        //
        // 3 deg hysteresis keeps the rest and peak bands apart at this
        // narrower spacing (return band 5..12 deg), with the same two-frame
        // dwell most exercises use. A fast return that skips that band
        // still counts (see MovementMachine._transition). Head wobble at
        // rest stays inside the rest band, and the 1 s minimum repetition
        // still rejects twitches.
        restAngle: 5,
        peakAngle: 15,
        hysteresisDeg: 3,
        minStateFrames: 2,
        cooldownMs: 700,
        minRepDurationMs: 1000,
        maxRepDurationMs: 15000,
        cues: {
          IDLE: 'Face the camera with your head upright to begin.',
          UP: 'Slowly tilt your {side} ear towards your {side} shoulder.',
          GOING_DOWN: 'Keep tilting - move further, ear towards shoulder.',
          DOWN: 'Movement completed - now bring your head back to the centre.',
          GOING_UP: 'Return your head to upright.',
          REP: 'Repetition complete - head upright before the next one.',
        },
      },
      postureRules: [
        {
          code: 'INCOMPLETE_ROM',
          angle: 'neckTilt',
          when: 'at_peak',
          min: 17,
          joint: 'neck',
          message:
            'Move further - bring your {side} ear a little closer to your shoulder.',
        },
        {
          code: 'WRONG_SIDE_MOVEMENT',
          angle: 'neckTilt',
          when: 'always',
          min: -10,
          joint: 'neck',
          message:
            'Movement detected on the wrong side - you are tilting towards your {other} shoulder. This session is for the {side} side.',
        },
        {
          code: 'SHOULDER_HITCH',
          angle: '_shoulderLevel',
          when: 'always',
          max: 0.15,
          joint: 'shoulder',
          message:
            "Keep your shoulders relaxed and level - don't lift a shoulder towards your ear.",
        },
        {
          code: 'TRUNK_COMPENSATION',
          angle: 'trunkTilt',
          when: 'always',
          max: 8,
          joint: 'trunk',
          message:
            'Keep your torso upright and still - bend only your neck, not your whole body.',
        },
        {
          gate: true,
          code: 'WRONG_CAMERA_VIEW',
          // Measured 0.63 for a person facing the camera on a real photo
          // through YOLOv8n. 0.5 tolerates a turn of roughly 35 degrees
          // before pausing.
          angle: '_frontalRatio',
          min: 0.5,
          message:
            'Incorrect camera position - face the camera directly with both shoulders in view. Counting is paused.',
        },
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },

  // -----------------------------------------------------------------------
  // Knee Extension (seated) - side view
  // -----------------------------------------------------------------------
  {
    slug: 'knee-extension',
    name: 'Knee Extension',
    description:
      'A seated quadriceps exercise: straightening the knee from a bent position to rebuild thigh strength and full knee extension.',
    instructions:
      'Sit upright on a firm chair with your back supported and both feet on the floor. Slowly straighten the knee of the leg you selected, lifting your foot until the leg is straight out in front of you. Hold for a moment, then lower the foot back down under control. Keep your thigh resting on the chair throughout.',
    category: 'Lower Body',
    difficulty: Difficulty.EASY,
    targetBodyArea: 'Knee, quadriceps',
    recommendedView: CameraView.SIDE,
    framingInstructions:
      'Sit SIDE-ON to the camera, about 2 metres away, with the leg you are exercising nearer the camera. Your shoulder, hip, knee and ankle on that side must all be in frame - place the camera at about knee-to-hip height. Counting pauses if you face the camera or the other leg is nearer.',
    defaultSets: 3,
    defaultReps: 10,
    sideMode: ExerciseSideMode.LIMB,
    isActive: true,
    ruleConfig: {
      version: 1,
      requiredLandmarks: [
        '{side}_shoulder', '{side}_hip', '{side}_knee', '{side}_ankle',
      ],
      angleDefinitions: {
        // Only the selected leg drives the count - no min/max/average across
        // both legs, so the resting leg cannot affect it.
        knee: { type: 'joint', a: '{side}_hip', b: '{side}_knee', c: '{side}_ankle' },
        // Seated, the thigh is near horizontal (~90 deg from vertical). A
        // thigh lifting off the chair (hip hitching to help) reads higher.
        thighTilt: { type: 'vertical', upper: '{side}_hip', lower: '{side}_knee' },
        trunkLean: { type: 'vertical', upper: '{side}_shoulder', lower: '{side}_hip' },
        _otherKnee: {
          type: 'joint',
          a: '{other}_hip',
          b: '{other}_knee',
          c: '{other}_ankle',
        },
        ...sideViewMeasures(),
      },
      movementStateConfig: {
        primaryAngle: 'knee',
        direction: 'INCREASING',
        // Seated rest is ~90 deg; below 110 counts as bent. Past 155 is a
        // clear extension.
        restAngle: 110,
        peakAngle: 155,
        hysteresisDeg: 8,
        minStateFrames: 2,
        cooldownMs: 600,
        minRepDurationMs: 900,
        maxRepDurationMs: 20000,
        cues: {
          IDLE: 'Sit upright with your {side} knee bent to begin.',
          UP: 'Straighten your {side} knee - lift your foot forward.',
          GOING_DOWN: 'Keep straightening - extend your knee fully.',
          DOWN: 'Movement completed - now lower your foot back down slowly.',
          GOING_UP: 'Return to the starting position, knee bent.',
          REP: 'Repetition complete.',
        },
      },
      postureRules: [
        {
          code: 'INCOMPLETE_ROM',
          angle: 'knee',
          when: 'at_peak',
          min: 165,
          joint: 'knee',
          message: 'Extend your knee fully - straighten your {side} leg a little more.',
        },
        {
          code: 'EXCESSIVE_MOVEMENT',
          angle: 'thighTilt',
          when: 'always',
          max: 115,
          joint: 'hip',
          message:
            'Keep your thigh resting on the chair - lift only your lower leg.',
        },
        {
          code: 'TRUNK_LEAN',
          angle: 'trunkLean',
          when: 'always',
          max: 25,
          joint: 'trunk',
          message: "Keep your torso upright - don't lean back to lift the leg.",
        },
        {
          code: 'WRONG_SIDE_MOVEMENT',
          angle: '_otherKnee',
          when: 'always',
          max: 150,
          joint: 'knee',
          message:
            'Movement detected on the wrong side - your {other} leg is straightening. This session is for your {side} leg.',
        },
        ...sideViewGates('{side} leg'),
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },

  // -----------------------------------------------------------------------
  // Standing Hip Extension (Glute Kickback) - side view
  // -----------------------------------------------------------------------
  {
    slug: 'standing-hip-extension',
    name: 'Standing Hip Extension (Glute Kickback)',
    description:
      'Moving the leg straight back from the hip while standing, to strengthen the gluteal muscles and restore hip extension.',
    instructions:
      'Stand tall holding the back of a chair or a wall for balance. Keeping your body upright and your knee fairly straight, move the leg you selected straight back behind you, squeezing your buttock. Pause, then bring the leg back under you. Do not lean forward or arch your back to get the leg higher.',
    category: 'Lower Body',
    difficulty: Difficulty.MEDIUM,
    targetBodyArea: 'Hip, glutes',
    recommendedView: CameraView.SIDE,
    framingInstructions:
      'Stand SIDE-ON to the camera, about 2-3 metres away, with your whole body from head to feet in frame and the leg you are exercising nearer the camera. A chair for support may be in front of you. Counting pauses if you face the camera or the other leg is nearer.',
    defaultSets: 3,
    defaultReps: 10,
    sideMode: ExerciseSideMode.LIMB,
    isActive: true,
    ruleConfig: {
      version: 1,
      requiredLandmarks: [
        'nose',
        '{side}_shoulder', '{side}_hip', '{side}_knee', '{side}_ankle',
      ],
      angleDefinitions: {
        // Hip extension measured as the THIGH against the line of the TRUNK
        // (shoulder -> hip, continued downward), positive when the knee goes
        // BEHIND the body. Measuring against the trunk rather than gravity
        // means leaning forward cannot fake extension, and measuring the
        // thigh (hip -> knee) means bending the knee cannot either.
        hipExtension: {
          type: 'signed_tilt',
          pivot: '{side}_hip',
          end: '{side}_knee',
          reference: ['{side}_shoulder', '{side}_hip'],
          facing: ['{side}_shoulder', 'nose'],
          positive: 'backward',
        },
        knee: { type: 'joint', a: '{side}_hip', b: '{side}_knee', c: '{side}_ankle' },
        trunkLean: { type: 'vertical', upper: '{side}_shoulder', lower: '{side}_hip' },
        _otherHipExtension: {
          type: 'signed_tilt',
          pivot: '{other}_hip',
          end: '{other}_knee',
          reference: ['{other}_shoulder', '{other}_hip'],
          facing: ['{other}_shoulder', 'nose'],
          positive: 'backward',
        },
        // Balance: how far the shoulders drift from over the standing foot,
        // relative to torso length.
        _balanceOffset: { type: 'gap_x', a: '{side}_shoulder', b: '{other}_ankle' },
        _balanceRatio: {
          type: 'ratio',
          numerator: '_balanceOffset',
          denominator: '_torsoLength',
        },
        ...sideViewMeasures(),
      },
      movementStateConfig: {
        primaryAngle: 'hipExtension',
        direction: 'INCREASING',
        // True hip extension is only about 10-20 deg, so the bands are
        // narrow: under 6 deg is standing, past 18 deg is a kickback. The
        // 5-frame median filter, 3-frame dwell and 3 deg hysteresis are what
        // keep balance adjustments from being counted.
        restAngle: 6,
        peakAngle: 18,
        hysteresisDeg: 3,
        minStateFrames: 3,
        cooldownMs: 700,
        minRepDurationMs: 900,
        maxRepDurationMs: 15000,
        cues: {
          IDLE: 'Stand tall, holding support, {side} side towards the camera.',
          UP: 'Move your {side} leg straight back, squeezing your glutes.',
          GOING_DOWN: 'Keep extending your hip - move further back.',
          DOWN: 'Movement completed - now bring your leg back under you slowly.',
          GOING_UP: 'Return to the starting position, feet together.',
          REP: 'Repetition complete.',
        },
      },
      postureRules: [
        {
          code: 'INCOMPLETE_ROM',
          angle: 'hipExtension',
          when: 'at_peak',
          min: 20,
          joint: 'hip',
          message: 'Move further - take your leg a little further back.',
        },
        {
          code: 'TRUNK_LEAN',
          angle: 'trunkLean',
          when: 'always',
          max: 20,
          joint: 'trunk',
          message:
            'Keep your torso upright - avoid leaning forward as your leg goes back.',
        },
        {
          code: 'KNEE_FLEXED',
          angle: 'knee',
          when: 'always',
          min: 130,
          joint: 'knee',
          message:
            'Keep your {side} knee fairly straight - move from the hip, not the knee.',
        },
        {
          code: 'LOSS_OF_BALANCE',
          angle: '_balanceRatio',
          when: 'always',
          max: 0.6,
          joint: 'hip',
          message:
            'Maintain balance - keep your shoulders over your standing foot and hold your support.',
        },
        {
          code: 'WRONG_SIDE_MOVEMENT',
          angle: '_otherHipExtension',
          when: 'always',
          max: 15,
          joint: 'hip',
          message:
            'Movement detected on the wrong side - your {other} leg is moving back. This session is for your {side} leg.',
        },
        ...sideViewGates('{side} leg'),
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },

  // -----------------------------------------------------------------------
  // Elbow Extension - side view
  // -----------------------------------------------------------------------
  {
    slug: 'elbow-extension',
    name: 'Elbow Extension',
    description:
      'Straightening the elbow from a bent position with the upper arm held still, to restore full elbow extension and triceps control.',
    instructions:
      'Stand tall with your upper arm close to your side and your elbow bent so your hand is in front of you at about waist height or higher. Keeping your upper arm still, straighten your elbow fully so your arm points down. Pause, then bend the elbow back to the start. Move only the forearm.',
    category: 'Upper Body',
    difficulty: Difficulty.EASY,
    targetBodyArea: 'Elbow, triceps',
    recommendedView: CameraView.SIDE,
    framingInstructions:
      'Stand SIDE-ON to the camera, about 2 metres away, with the arm you are exercising nearer the camera. Your shoulder, elbow, wrist and hip on that side must be in frame. Start with the elbow bent - counting begins once the camera sees the bent starting position. Counting pauses if you face the camera or the other arm is nearer.',
    defaultSets: 3,
    defaultReps: 12,
    sideMode: ExerciseSideMode.LIMB,
    isActive: true,
    ruleConfig: {
      version: 1,
      requiredLandmarks: [
        '{side}_shoulder', '{side}_elbow', '{side}_wrist', '{side}_hip',
      ],
      angleDefinitions: {
        elbow: {
          type: 'joint',
          a: '{side}_shoulder',
          b: '{side}_elbow',
          c: '{side}_wrist',
        },
        // Upper arm against gravity: 0 deg hanging at the side. Swinging it
        // forward or back to help is the "excessive shoulder movement" fault.
        upperArmTilt: {
          type: 'vertical',
          upper: '{side}_shoulder',
          lower: '{side}_elbow',
        },
        trunkLean: { type: 'vertical', upper: '{side}_shoulder', lower: '{side}_hip' },
        _otherElbow: {
          type: 'joint',
          a: '{other}_shoulder',
          b: '{other}_elbow',
          c: '{other}_wrist',
        },
        ...sideViewMeasures(),
      },
      movementStateConfig: {
        primaryAngle: 'elbow',
        direction: 'INCREASING',
        // Bent start below 95 deg; straight past 155 deg.
        restAngle: 95,
        peakAngle: 155,
        hysteresisDeg: 8,
        minStateFrames: 2,
        cooldownMs: 500,
        minRepDurationMs: 700,
        maxRepDurationMs: 15000,
        cues: {
          IDLE: 'Bend your {side} elbow, upper arm by your side, to begin.',
          UP: 'Straighten your {side} elbow - push your hand down.',
          GOING_DOWN: 'Keep straightening your elbow.',
          DOWN: 'Movement completed - now bend your elbow back up slowly.',
          GOING_UP: 'Return to the bent-elbow starting position.',
          REP: 'Repetition complete.',
        },
      },
      postureRules: [
        {
          code: 'INCOMPLETE_ROM',
          angle: 'elbow',
          when: 'at_peak',
          min: 165,
          joint: 'elbow',
          message: 'Straighten your elbow fully.',
        },
        {
          code: 'EXCESSIVE_MOVEMENT',
          angle: 'upperArmTilt',
          when: 'always',
          max: 30,
          joint: 'shoulder',
          message:
            'Excessive shoulder movement - keep your upper arm still by your side and move only your forearm.',
        },
        {
          code: 'TRUNK_LEAN',
          angle: 'trunkLean',
          when: 'always',
          max: 15,
          joint: 'trunk',
          message: "Stand tall - don't lean your body to help the arm.",
        },
        {
          code: 'WRONG_SIDE_MOVEMENT',
          angle: '_otherElbow',
          when: 'always',
          min: 110,
          joint: 'elbow',
          message:
            'Movement detected on the wrong side - your {other} arm is bending. Keep it relaxed and use your {side} arm.',
        },
        ...sideViewGates('{side} arm'),
      ],
      minVisibility: 0.5,
      repCorrectnessThreshold: 70,
    },
  },
];
