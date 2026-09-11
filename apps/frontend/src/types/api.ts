/**
 * Shared API types.
 *
 * These mirror the backend DTOs and the pose service's Pydantic models. The
 * generated OpenAPI types (`npm run openapi:types`) cover the REST surface;
 * the pose WebSocket contract is hand-written here because it is not part of
 * the OpenAPI document, and it must stay in step with
 * services/pose-service/app/schemas/pose.py.
 */

export type UserRole = 'PATIENT' | 'THERAPIST' | 'ADMIN';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type CameraView = 'FRONT' | 'SIDE' | 'FRONT_OBLIQUE';
export type SessionStatus =
  | 'CREATED'
  | 'ACTIVE'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  timezone: string;
  patientProfileId?: string;
  therapistProfileId?: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export interface ExerciseSummary {
  slug: string;
  name: string;
  category?: string;
  difficulty?: Difficulty;
  targetBodyArea?: string;
  recommendedView?: CameraView;
}

export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

/** A course of treatment. Every assignment is prescribed under one. */
export interface RehabilitationPlan {
  id: string;
  title: string;
  goals: string | null;
  startDate: string;
  endDate: string | null;
  status: PlanStatus;
  notes: string | null;
  therapistName: string;
  assignmentCount: number;
}

export interface Assignment {
  id: string;
  exercise: ExerciseSummary;
  /**
   * The plan this exercise belongs to.
   *
   * Nullable only for rows created before a plan became mandatory. The
   * patient's plan view groups those under a separate heading rather than
   * dropping them, because they are still exercises they were told to do.
   */
  planId?: string | null;
  plan?: { id: string; title: string } | null;
  targetSets: number;
  repsPerSet: number;
  targetTotalReps: number;
  /**
   * REPS or HOLD. Read this BEFORE targetSets/repsPerSet: a HOLD assignment
   * carries them only because the columns are NOT NULL, and displaying
   * "1 set x 1 rep" for a posture exercise would be nonsense.
   *
   * Null only on responses that predate the field.
   */
  goalType: ExerciseGoalType | null;
  /** HOLD only: prescribed seconds, already resolved against the default. */
  holdSeconds: number | null;
  difficulty: Difficulty;
  instructions: string | null;
  scheduledDays: number[];
  scheduledToday?: boolean;
  startDate: string;
  endDate: string | null;
  status?: string;
  /**
   * Sessions recorded against this assignment.
   *
   * Only present on the therapist's list, which is the one screen that needs
   * it: removing an assignment with recorded sessions ARCHIVES it rather than
   * deleting it, and the confirmation has to say which will happen.
   */
  sessionCount?: number | null;
}

export interface AssignmentDetail extends Assignment {
  exerciseDetail: {
    slug: string;
    name: string;
    description: string;
    instructions: string;
    recommendedView: CameraView;
    framingInstructions: string;
    targetBodyArea: string;
    goalType: ExerciseGoalType;
  };
  therapistName: string;
  completedSessions: number;
}

export interface SessionSummary {
  id: string;
  exercise: ExerciseSummary;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  totalReps: number;
  targetTotalReps: number;
  correctReps: number;
  incorrectReps: number;
  performanceScore: number | null;
  status?: SessionStatus;
  hasReport?: boolean;
  /** REPS or HOLD; null on responses that predate the field. */
  goalType?: ExerciseGoalType | null;
  /** HOLD only. A history row showing "0 of 1 reps" would read as a failure. */
  heldSec?: number | null;
  targetHoldSec?: number | null;
}

export interface CreatedSession {
  id: string;
  status: SessionStatus;
  /**
   * True when this session was already running and has been handed back
   * rather than newly created - a reload, a dropped socket, a tab the browser
   * discarded. The repetitions already counted are still on it.
   *
   * Optional only for responses that predate the field.
   */
  resumed?: boolean;
  exercise: {
    slug: string;
    name: string;
    instructions: string;
    recommendedView: CameraView;
    framingInstructions: string;
  };
  goalType: ExerciseGoalType;
  targetSets: number;
  repsPerSet: number;
  targetTotalReps: number;
  targetHoldSec: number | null;
  ruleConfigVersion: number;
  startedAt: string;
}

export interface PoseTicket {
  ticket: string;
  expiresIn: number;
}

export interface PatientDashboard {
  stats: {
    totalSessions: number;
    averageScore: number | null;
    totalReps: number;
    correctReps: number;
    activeAssignments: number;
  };
  assignments: Assignment[];
  recentSessions: SessionSummary[];
  unreadNotifications: number;
  recentFeedback: {
    id: string;
    type: string;
    body: string;
    createdAt: string;
    therapistName: string;
  }[];
}

export interface TherapistDashboard {
  caseload: number;
  activePlans: number;
  activeAssignments: number;
  sessionsThisWeek: number;
  averageScore: number | null;
  recentSessions: {
    sessionId: string;
    patientProfileId: string;
    patientName: string;
    exercise: string;
    startedAt: string;
    goalType: ExerciseGoalType | null;
    totalReps: number;
    targetTotalReps: number;
    heldSec: number | null;
    targetHoldSec: number | null;
    performanceScore: number | null;
  }[];
  patientsNeedingReview: {
    patientProfileId: string;
    name: string;
    reason: string;
  }[];
}

export interface CaseloadPatient {
  patientProfileId: string;
  name: string;
  email: string;
  conditionSummary: string | null;
  isPrimary: boolean;
  linkedAt: string;
  /** Set only on `scope=archived` rows: when the link was ended. */
  archivedAt?: string | null;
  activePlan: { id: string; title: string } | null;
  totalSessions: number;
  lastSessionAt: string | null;
  lastSessionScore: number | null;
}

export interface AngleStat {
  min: number;
  max: number;
  mean: number;
}

export interface SessionReport {
  sessionId: string;
  generatedAt: string;
  patient: { id: string; name: string };
  exercise: { name: string; slug: string; category: string };
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  /** Decides whether `prescription` or `hold` describes what was asked for. */
  goalType: ExerciseGoalType;
  prescription: {
    targetSets: number;
    repsPerSet: number;
    targetTotalReps: number;
  };
  /** Non-null only for a HOLD session. */
  hold: {
    targetSec: number;
    heldSec: number;
    bestStreakSec: number;
  } | null;
  results: {
    totalReps: number;
    correctReps: number;
    incorrectReps: number;
    performanceScore: number;
    completionRatio: number;
  };
  tracking: { avgConfidence: number; note: string };
  angleStats: Record<string, AngleStat>;
  commonErrors: { code: string; severity: string; occurrences: number }[];
  summary: string;
  disclaimer: string;
}

export interface ProgressData {
  summary: {
    totalSessions: number;
    totalReps: number;
    correctReps: number;
    incorrectReps: number;
    correctRepRatio: number;
    averageScore: number | null;
    firstSessionAt: string | null;
    lastSessionAt: string | null;
  };
  timeline: {
    sessionId: string;
    date: string;
    exercise: string;
    exerciseSlug: string;
    performanceScore: number;
    totalReps: number;
    correctReps: number;
    targetTotalReps: number;
    completionRatio: number;
  }[];
  byExercise: {
    slug: string;
    name: string;
    sessions: number;
    averageScore: number | null;
    totalReps: number;
    correctReps: number;
  }[];
  recurringIssues: { code: string; occurrences: number }[];
  methodology: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  payload: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Pose service WebSocket contract
// Mirrors services/pose-service/app/schemas/pose.py
// ---------------------------------------------------------------------------

export type MovementState =
  | 'IDLE'
  | 'UP'
  | 'GOING_DOWN'
  | 'DOWN'
  | 'GOING_UP'
  /** HOLD exercises: correctly aligned right now. There is no cycle. */
  | 'HOLDING';

/**
 * How an exercise decides it is finished.
 *
 * REPS - a countable movement cycle, measured in sets x repetitions.
 * HOLD - a sustained position, measured in seconds of correct alignment.
 *        Postural correction is the case: there is no honest way to say where
 *        one repetition of standing up straight ends.
 */
export type ExerciseGoalType = 'REPS' | 'HOLD';

/** Live progress for a HOLD exercise. Absent on REPS exercises. */
export interface HoldProgress {
  heldSeconds: number;
  targetSeconds: number;
  remainingSeconds: number;
  /** Completion in [0, 1]. */
  progress: number;
  /** Correctly aligned right now. */
  active: boolean;
  /** Seconds in the current unbroken stretch. */
  streakSeconds: number;
  bestStreakSeconds: number;
}

export interface PoseLandmark {
  name: string;
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseError {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  joint?: string | null;
  observed?: number | null;
  expected?: Record<string, number> | null;
}

export interface PoseUpdateData {
  sessionId: string;
  exercise: string;
  frameIndex: number;
  personDetected: boolean;
  peopleDetected: number;
  trackingValid: boolean;
  /** Mean visibility of required landmarks. NOT an accuracy figure. */
  confidence: number;
  landmarks: PoseLandmark[];
  missingLandmarks: string[];
  angles: Record<string, number>;
  movementState: MovementState;
  stateHeldMs: number;
  /** Which of `rep` and `hold` carries this exercise's progress. */
  goalType: ExerciseGoalType;
  rep: {
    completed: boolean;
    count: number;
    targetCount: number;
    currentSet: number;
    targetSets: number;
    lastRepScore?: number | null;
  };
  /**
   * Present only for a HOLD exercise. When it is set, `rep.count` stays 0
   * forever and this is what the screen should be showing.
   */
  hold: HoldProgress | null;
  posture: { correct: boolean; score: number };
  errors: PoseError[];
  latencyMs: {
    decode: number;
    inference: number;
    analysis: number;
    total: number;
  };
  timestamp: string;
}

export interface RepCompletedData {
  sessionId: string;
  repNumber: number;
  setNumber: number;
  correct: boolean;
  score: number;
  trackingConfidence: number;
  totalReps: number;
  targetTotalReps: number;
  angleSummary: Record<string, AngleStat>;
  /** False when the backend could not store it - surfaced, never hidden. */
  persisted: boolean;
}

export interface SessionReadyData {
  sessionId: string;
  exercise: string;
  targetSets: number;
  repsPerSet: number;
  targetTotalReps: number;
  resumedFromRep: number;
  ruleConfigVersion: number;
  framingInstructions: string;
  recommendedView: string;
  /** Known before the first frame, so the HUD renders correctly from the start. */
  goalType: ExerciseGoalType;
  targetHoldSeconds: number;
  resumedFromHeldSeconds: number;
}

/** Sent once, when the pose service decides the session is finished. */
export interface SessionClosedData {
  sessionId: string;
  /** 'GOAL_REACHED' today; kept open for future reasons. */
  reason: string;
  goalType: ExerciseGoalType;
  totalReps: number;
  targetTotalReps: number;
  heldSeconds: number;
  targetHoldSeconds: number;
}

export type PoseServerMessage =
  | { type: 'session:ready'; data: SessionReadyData }
  | { type: 'pose:update'; data: PoseUpdateData }
  | { type: 'rep:completed'; data: RepCompletedData }
  | { type: 'tracking:warning'; data: { code: string; severity: string; message: string } }
  | { type: 'pose:error'; data: { code: string; message: string; recoverable: boolean } }
  | { type: 'session:closed'; data: SessionClosedData };
