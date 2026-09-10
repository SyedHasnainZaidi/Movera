import { CameraView, Difficulty, ExerciseGoalType } from '@prisma/client';

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
  isActive: boolean;
  ruleConfig?: RuleConfigSeed;
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
    recommendedView: CameraView.FRONT,
    framingInstructions:
      'Stand facing the camera, 2-3 metres away, with your whole body from shoulders to ankles in frame. Only the patient should be visible.',
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
        // Both knees flex together in a squat, so averaging is correct here.
        knee: { type: 'average', of: ['leftKnee', 'rightKnee'] },

        leftHip: { type: 'joint', a: 'left_shoulder', b: 'left_hip', c: 'left_knee' },
        rightHip: { type: 'joint', a: 'right_shoulder', b: 'right_hip', c: 'right_knee' },
        hip: { type: 'average', of: ['leftHip', 'rightHip'] },

        // squat.py: knee_width < ankle_width * 0.7 -> "Keep knees aligned".
        // Expressed as a ratio because both widths scale with how far away the
        // patient stands, so neither works as a fixed pixel threshold.
        kneeWidth: { type: 'gap_x', a: 'left_knee', b: 'right_knee' },
        ankleWidth: { type: 'gap_x', a: 'left_ankle', b: 'right_ankle' },
        kneeAnkleRatio: { type: 'ratio', numerator: 'kneeWidth', denominator: 'ankleWidth' },
      },
      movementStateConfig: {
        primaryAngle: 'knee',
        direction: 'DECREASING',
        // squat.py _detect_state: >160 standing, 70-120 down.
        restAngle: 160,
        peakAngle: 120,
        hysteresisDeg: 8,
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
          // squat.py: hip_angle < 150 -> "Keep your back straight".
          code: 'TRUNK_LEAN',
          angle: 'hip',
          when: 'always',
          min: 150,
          joint: 'hip',
        },
        {
          // squat.py: knee_width < ankle_width * 0.7 -> "Keep knees aligned".
          code: 'KNEE_ALIGNMENT',
          angle: 'kneeAnkleRatio',
          when: 'always',
          min: 0.7,
          joint: 'knee',
        },
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
    recommendedView: CameraView.SIDE,
    framingInstructions:
      'Stand side-on to the camera, about 2 metres away, with your shoulder, elbow, wrist AND hip all in frame. Straighten your arm fully at the bottom of every repetition - the counter needs to see the arm reach full extension before it will count the next one.',
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
];
