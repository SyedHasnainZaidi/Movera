import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  api,
  getErrorCode,
  getErrorDetails,
  getErrorMessage,
} from '../../api/client';
import { Button, ErrorState, PrototypeDisclaimer } from '../../components/ui';
import { MoveraMark } from '../../components/MoveraLogo';
import { useCamera } from '../../features/camera/useCamera';
import { PoseOverlay } from '../../features/session/PoseOverlay';
import {
  FeedbackBanner,
  HoldCounter,
  MovementReadout,
  RepCounter,
  TrackingQuality,
} from '../../features/session/SessionHud';
import { formatSeconds } from '../../lib/prescription';
import { useFrameSampler } from '../../features/session/useFrameSampler';
import { usePoseSocket } from '../../features/session/usePoseSocket';
import type {
  AssignmentDetail,
  CreatedSession,
  ExerciseGoalType,
  PoseError,
  PoseTicket,
  PoseUpdateData,
  RepCompletedData,
  SessionClosedData,
  SessionReadyData,
} from '../../types/api';

/**
 * UI phase, deliberately distinct from the database SessionStatus.
 *
 * The server tracks CREATED / ACTIVE / COMPLETED. The screen additionally has
 * to represent "waiting for camera permission", "connecting", and "finishing",
 * none of which are database states.
 */
type Phase =
  | 'setup'
  | 'camera'
  | 'connecting'
  | 'live'
  //: The patient pressed Finish.
  | 'finishing'
  //: The GOAL was reached and the session is ending ITSELF. Distinct from
  //: 'finishing' because the patient did not ask for it and has to be told
  //: what happened before the screen changes under them.
  | 'completing'
  //: A live session on a DIFFERENT exercise is blocking this one. Separate
  //: from 'error' because it is recoverable and the patient has to be given
  //: the two ways out - go to that session, or cancel it.
  | 'conflict'
  | 'error';

/** The live session reported by a 409 from POST /sessions. */
interface BlockingSession {
  sessionId: string;
  assignmentId: string;
  exerciseName: string;
  status: string;
  startedAt: string;
}

/** How long one corrective cue is held before another may replace it. */
const FEEDBACK_HOLD_MS = 2000;

const SEVERITY_RANK: Record<string, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export function LiveSessionPage() {
  const { assignmentId = '' } = useParams();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('setup');
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [session, setSession] = useState<CreatedSession | null>(null);
  const [ready, setReady] = useState<SessionReadyData | null>(null);
  const [pose, setPose] = useState<PoseUpdateData | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  //: The other live session standing in the way, from the 409 details.
  const [blocking, setBlocking] = useState<BlockingSession | null>(null);
  //: True when POST /sessions handed back a session that was already running,
  //: so the screen can say the repetitions already counted have been kept.
  const [resumed, setResumed] = useState(false);
  const [unpersistedReps, setUnpersistedReps] = useState(0);
  const [lastRep, setLastRep] = useState<RepCompletedData | null>(null);
  //: Set when the session ends itself. Drives the completion screen, which
  //: reports what was achieved rather than vanishing straight to the report.
  const [completion, setCompletion] = useState<SessionClosedData | null>(null);

  // Held cue, so messages do not flicker at the frame rate.
  const [heldFeedback, setHeldFeedback] = useState<PoseError | null>(null);
  const feedbackUntilRef = useRef(0);

  const camera = useCamera();

  const handlePoseUpdate = useCallback((data: PoseUpdateData) => {
    setPose(data);

    const worst = [...data.errors].sort(
      (a, b) =>
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
    )[0];

    const now = performance.now();
    if (worst) {
      // A more severe cue always wins immediately; an equal-or-lesser one has
      // to wait for the current message to finish its hold.
      const current = heldFeedbackRef.current;
      const outranksCurrent =
        !current ||
        (SEVERITY_RANK[worst.severity] ?? 0) >
          (SEVERITY_RANK[current.severity] ?? 0);

      if (outranksCurrent || now >= feedbackUntilRef.current) {
        setHeldFeedback(worst);
        feedbackUntilRef.current = now + FEEDBACK_HOLD_MS;
      }
    } else if (now >= feedbackUntilRef.current) {
      setHeldFeedback(null);
    }
  }, []);

  // Mirror of heldFeedback for use inside the (stable) callback above.
  const heldFeedbackRef = useRef<PoseError | null>(null);
  heldFeedbackRef.current = heldFeedback;

  const handleRepCompleted = useCallback((data: RepCompletedData) => {
    setLastRep(data);
    if (!data.persisted) {
      // A repetition the patient really performed that could not be saved.
      // Surfaced rather than silently dropped.
      setUnpersistedReps((count) => count + 1);
    }
  }, []);

  const handleSessionReady = useCallback((data: SessionReadyData) => {
    setReady(data);
    setPhase('live');
  }, []);

  /**
   * The pose service says the prescription is complete.
   *
   * This is what ends the session - not the patient pressing Finish. Leaving a
   * finished session running asks the patient to decide when they are done
   * with something the app already knows the answer to, and every session left
   * open that way blocks their next one under the one-live-session rule.
   *
   * Guarded by a ref rather than by state because frames are still arriving
   * while this runs: a second GOAL_REACHED must not restart the teardown
   * halfway through the first.
   */
  const autoFinishedRef = useRef(false);
  const handleClosed = (data: SessionClosedData) => {
    if (data.reason !== 'GOAL_REACHED' || autoFinishedRef.current) return;
    autoFinishedRef.current = true;
    setCompletion(data);
    void finishSession({ automatic: true });
  };

  const socket = usePoseSocket({
    onPoseUpdate: handlePoseUpdate,
    onRepCompleted: handleRepCompleted,
    onSessionReady: handleSessionReady,
    onClosed: handleClosed,
  });

  const sampler = useFrameSampler({
    videoRef: camera.videoRef,
    canSend: () => !socket.isBusy(),
    onFrame: socket.sendFrame,
  });

  // --- load the assignment ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    api
      .get<AssignmentDetail>(`/assignments/${assignmentId}`)
      .then(({ data }) => {
        if (!cancelled) setAssignment(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setFatalError(getErrorMessage(error));
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  // --- start frame sampling once the socket is live -----------------------
  useEffect(() => {
    if (phase === 'live' && socket.status === 'ready') {
      sampler.start();
      return () => sampler.stop();
    }
    return undefined;
  }, [phase, socket.status, sampler]);

  // --- teardown: stop everything, always ----------------------------------
  useEffect(
    () => () => {
      sampler.stop();
      socket.disconnect();
      camera.stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Mirrors for the visibility listener below. It is registered once, so it
  // must not close over the first render's values.
  const sessionRef = useRef<CreatedSession | null>(null);
  sessionRef.current = session;
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const socketStatusRef = useRef(socket.status);
  socketStatusRef.current = socket.status;
  const reconnectRef = useRef<() => Promise<void>>(() => Promise.resolve());

  /**
   * Coming back to a backgrounded tab.
   *
   * The frame sampler is driven by requestAnimationFrame, which the browser
   * pauses while the tab is hidden - that part is deliberate and fine. What is
   * not fine is what happens to the socket: a tab left in the background long
   * enough is frozen or discarded, and the connection to the analysis service
   * goes with it. The patient then returns to a session that looks live and
   * silently counts nothing.
   *
   * So on becoming visible again, if there is a session and the socket is no
   * longer up, reconnect with a fresh ticket. One attempt per return to the
   * tab, never a retry loop: reconnecting needs a new ticket from the backend,
   * and a loop against a failing service would just hammer it.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!sessionRef.current) return;
      if (phaseRef.current !== 'live' && phaseRef.current !== 'connecting') {
        return;
      }
      const status = socketStatusRef.current;
      if (status === 'ready' || status === 'connecting') return;
      void reconnectRef.current();
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // --- actions ------------------------------------------------------------

  const beginCamera = async () => {
    setPhase('camera');
    await camera.start();
  };

  /**
   * Session start order matters:
   *   1. create the session (server validates the assignment)
   *   2. THEN mint the pose ticket
   * The ticket lives ~2 minutes, so it is requested only once the camera is
   * already running - otherwise a slow permission prompt would burn most of it.
   */
  const startSession = async () => {
    setPhase('connecting');
    setFatalError(null);
    setBlocking(null);
    try {
      const { data: created } = await api.post<CreatedSession>('/sessions', {
        assignmentId,
      });
      setSession(created);
      setResumed(created.resumed === true);

      const { data: ticket } = await api.post<PoseTicket>(
        `/sessions/${created.id}/pose-ticket`,
      );
      socket.connect(ticket.ticket);
    } catch (error) {
      // A live session on a DIFFERENT exercise is the one failure here that
      // the patient can actually do something about, so it gets its own screen
      // rather than a dead-end error. Returning to the SAME exercise no longer
      // reaches this path at all - the server hands that session back.
      const details = getErrorDetails<BlockingSession>(error);
      if (getErrorCode(error) === 'SESSION_ALREADY_LIVE' && details) {
        setBlocking(details);
        setPhase('conflict');
        return;
      }
      setFatalError(getErrorMessage(error));
      setPhase('error');
    }
  };

  /**
   * Cancel the session that is blocking this one, then start this one.
   *
   * Only ever reached from the conflict screen, where the patient has been
   * told which exercise is being cancelled by name - this must not be a
   * silent cleanup of work they might still want.
   */
  const cancelBlockingAndStart = async () => {
    if (!blocking) return;
    setPhase('connecting');
    try {
      await api.post(`/sessions/${blocking.sessionId}/cancel`);
    } catch (error) {
      setFatalError(getErrorMessage(error));
      setPhase('error');
      return;
    }
    setBlocking(null);
    await startSession();
  };

  /** Reconnect after a dropped socket - always with a FRESH ticket. */
  const reconnect = async () => {
    if (!session) return;
    setPhase('connecting');
    try {
      const { data: ticket } = await api.post<PoseTicket>(
        `/sessions/${session.id}/pose-ticket`,
      );
      socket.connect(ticket.ticket);
    } catch (error) {
      setFatalError(getErrorMessage(error));
      setPhase('error');
    }
  };
  reconnectRef.current = reconnect;

  /**
   * Finalize and go to the report.
   *
   * One path for both endings. The patient pressing Finish and the goal being
   * reached differ only in what the screen says while it happens: the server
   * work, the teardown order and the failure handling are identical, and
   * duplicating them would be how the two quietly drift apart.
   */
  const finishSession = async ({ automatic = false } = {}) => {
    if (!session) return;
    setPhase(automatic ? 'completing' : 'finishing');
    setFatalError(null);

    // Stop producing frames BEFORE telling the server to finalize, so no
    // repetition can be ingested after the totals are computed.
    sampler.stop();
    socket.disconnect();
    camera.stop();

    try {
      await api.post(`/sessions/${session.id}/complete`);
      navigate(`/patient/sessions/${session.id}/report`, { replace: true });
    } catch (error) {
      // Do NOT discard the session on a failed completion - the work is
      // already stored server-side and completion is idempotent, so retrying
      // is always safe.
      //
      // An automatic finish stays on the completion screen with a retry
      // button: the camera is already down, so returning to a "live" view that
      // cannot see anything would be a lie about the state of the session.
      setFatalError(
        automatic
          ? `${getErrorMessage(error)} Your session is saved - press Retry to open your report.`
          : `${getErrorMessage(error)} Your repetitions are saved - press Finish again to retry.`,
      );
      if (!automatic) setPhase('live');
    }
  };

  const cancelSession = async () => {
    sampler.stop();
    socket.disconnect();
    camera.stop();
    if (session) {
      await api.post(`/sessions/${session.id}/cancel`).catch(() => {});
    }
    navigate('/patient', { replace: true });
  };

  // --- render -------------------------------------------------------------

  if (phase === 'error') {
    return (
      <Console>
        <div className="mx-auto max-w-2xl px-4 py-10">
          <ErrorState
            message={fatalError ?? 'This session could not be started.'}
            onRetry={() => navigate('/patient')}
          />
        </div>
      </Console>
    );
  }

  // ---- another exercise is already running ----
  if (phase === 'conflict' && blocking) {
    return (
      <Console>
        <div className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="type-display text-[22px] text-white">
            A session is already running
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-stage-200">
            You started <strong>{blocking.exerciseName}</strong> at{' '}
            {new Date(blocking.startedAt).toLocaleTimeString()} and it has not
            been finished. Only one exercise can be in progress at a time.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              variant="console"
              onClick={() =>
                navigate(`/patient/session/${blocking.assignmentId}`, {
                  replace: true,
                })
              }
            >
              Go back to {blocking.exerciseName}
            </Button>
            <Button variant="console" onClick={() => void cancelBlockingAndStart()}>
              Cancel it and start this one
            </Button>
            <Button variant="console" onClick={() => navigate('/patient')}>
              Back to my dashboard
            </Button>
          </div>

          <p className="mt-4 text-xs text-stage-400">
            Cancelling keeps any repetitions already recorded — they stay in
            your history as an unfinished session.
          </p>
        </div>
      </Console>
    );
  }

  // ---- the session ended itself ----
  if (phase === 'completing') {
    return (
      <SessionCompleteScreen
        completion={completion}
        error={fatalError}
        onRetry={() => void finishSession({ automatic: true })}
      />
    );
  }

  if (!assignment) {
    return (
      <Console>
        <div className="mx-auto max-w-2xl px-4 py-10">
          <p className="text-sm text-stage-400" role="status" aria-live="polite">
            Loading exercise…
          </p>
        </div>
      </Console>
    );
  }

  const detail = assignment.exerciseDetail;
  // Known from the assignment before the socket connects, then confirmed by
  // session:ready. Taking it from the assignment first means the setup screen
  // describes the right prescription without waiting for a WebSocket.
  const goalType: ExerciseGoalType =
    ready?.goalType ?? detail.goalType ?? 'REPS';
  const isHold = goalType === 'HOLD';
  const targetHoldSeconds =
    ready?.targetHoldSeconds ?? assignment.holdSeconds ?? 0;

  // ---- setup screen ----
  if (phase === 'setup' || phase === 'camera') {
    return (
      <Console>
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="reveal">
            <h1 className="type-display text-[28px] leading-tight text-white">
              {detail.name}
            </h1>
            <p className="type-measure mt-1 text-sm text-stage-300">
              {isHold ? (
                <>
                  Hold correct alignment for {formatSeconds(targetHoldSeconds)}{' '}
                  in total · the session ends by itself when you get there
                </>
              ) : (
                <>
                  {assignment.targetSets} sets of {assignment.repsPerSet}{' '}
                  repetitions · {assignment.targetTotalReps} in total
                </>
              )}
            </p>
          </div>

          {/*
            Two briefings before the camera opens: how to do the exercise, and
            how to stand so the analysis can see it. They are numbered because
            they genuinely are a sequence - reading the second one first would
            have the patient framing a movement they have not read yet.
          */}
          <ol className="mt-7 space-y-3">
            <li
              className="reveal rounded-panel border border-white/10 bg-white/[0.04] p-5"
              style={{ ['--reveal-index' as string]: 1 }}
            >
              <StepHeading step={1} title="How to perform it" />
              <p className="mt-2 text-sm leading-relaxed text-stage-200">
                {detail.instructions}
              </p>
              {assignment.instructions && (
                <p className="mt-3 rounded-readout border-l-2 border-brand-400 bg-brand-400/10 px-3 py-2 text-sm text-brand-300">
                  <span className="font-medium">From your therapist: </span>
                  {assignment.instructions}
                </p>
              )}
            </li>

            <li
              className="reveal rounded-panel border border-white/10 bg-white/[0.04] p-5"
              style={{ ['--reveal-index' as string]: 2 }}
            >
              <StepHeading
                step={2}
                title={`Set up the camera (${detail.recommendedView
                  .toLowerCase()
                  .replace('_', ' ')} view)`}
              />
              <p className="mt-2 text-sm leading-relaxed text-stage-200">
                {detail.framingInstructions}
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-stage-300">
                <li>Make sure the room is evenly lit.</li>
                <li>Only the patient should be visible in frame.</li>
                <li>
                  Nothing you record is stored - frames are analysed and
                  discarded.
                </li>
              </ul>
            </li>
          </ol>

          <div
            className="reveal mt-7"
            style={{ ['--reveal-index' as string]: 3 }}
          >
            {phase === 'setup' ? (
              <Button size="lg" onClick={beginCamera}>
                Enable camera
              </Button>
            ) : (
              <CameraStage
                camera={camera}
                onRetry={() => camera.start()}
                onContinue={startSession}
              />
            )}
          </div>

          <PrototypeDisclaimer className="mt-10" onDark />
        </div>
      </Console>
    );
  }

  // ---- live session ----
  const repCount = pose?.rep.count ?? ready?.resumedFromRep ?? 0;
  const targetTotal = ready?.targetTotalReps ?? assignment.targetTotalReps;

  return (
    <Console
      bar={
        <>
          <div className="min-w-0">
            <h1 className="type-display truncate text-[15px] text-white">
              {detail.name}
            </h1>
            <p className="text-xs text-stage-400">
              {ready
                ? `Analysing with rule set v${ready.ruleConfigVersion}`
                : 'Connecting to analysis service…'}
            </p>
          </div>

          <LiveIndicator connected={socket.status === 'ready'} />

          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="console" onClick={cancelSession}>
              Cancel
            </Button>
            <Button
              onClick={() => void finishSession()}
              loading={phase === 'finishing'}
              disabled={phase === 'finishing'}
            >
              Finish early
            </Button>
          </div>
        </>
      }
    >
    <div className="mx-auto max-w-6xl px-4 py-6">
      {fatalError && (
        <div className="mb-4">
          <ErrorState message={fatalError} />
        </div>
      )}

      {socket.status === 'error' && socket.error && (
        <div className="mb-4">
          <ErrorState
            message={socket.error.message}
            onRetry={socket.error.recoverable ? reconnect : undefined}
          />
        </div>
      )}

      {/*
        Resuming a session that was already running.

        Shown because the counter does NOT start at zero in this case, and a
        patient who reconnected after their tab was backgrounded would
        otherwise be left guessing whether the number is theirs. Only worth
        saying while there is something to explain, so it goes once the
        repetition count has moved past where it resumed.
      */}
      {resumed && repCount > 0 && repCount === (ready?.resumedFromRep ?? 0) && (
        <div
          role="status"
          className="animate-cue-in mb-4 rounded-panel border border-brand-300/30 bg-brand-300/10 px-5 py-3"
        >
          <p className="text-sm font-medium text-brand-300">
            Picking up where you left off — {repCount} repetition
            {repCount === 1 ? '' : 's'} already counted and saved. Carry on.
          </p>
        </div>
      )}

      {unpersistedReps > 0 && (
        <div
          role="alert"
          className="animate-cue-in mb-4 rounded-panel border border-caution-300/30 bg-caution-300/10 px-5 py-3"
        >
          <p className="text-sm font-medium text-caution-300">
            {unpersistedReps} repetition{unpersistedReps === 1 ? '' : 's'} could
            not be saved to your record. They are still counted on screen but
            may not appear in your report.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          {/*
            The camera view is the brightest object on the screen and the only
            one with the largest radius. Everything around it is dark so that
            the patient's eye - and the room's light - go here.
          */}
          <div className="relative overflow-hidden rounded-stage bg-black shadow-stage ring-1 ring-white/10">
            <video
              ref={camera.attachVideo}
              playsInline
              muted
              autoPlay
              // Mirrored for the patient's comfort. The frames SENT for
              // analysis are not mirrored - see useFrameSampler.
              className="block h-auto w-full -scale-x-100"
            />
            <PoseOverlay
              landmarks={pose?.landmarks ?? []}
              missing={pose?.missingLandmarks ?? []}
              trackingValid={pose?.trackingValid ?? false}
              mirrored
              width={640}
              height={480}
            />

            <Viewfinder />

            {socket.status === 'connecting' && (
              <div className="absolute inset-0 grid place-items-center bg-stage/80 backdrop-blur-sm">
                <p className="flex items-center gap-2.5 text-sm font-medium text-white">
                  <span
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-300 border-t-transparent"
                    aria-hidden="true"
                  />
                  Connecting to the analysis service…
                </p>
              </div>
            )}
          </div>

          <div className="mt-4">
            <FeedbackBanner
              error={heldFeedback}
              postureCorrect={pose?.posture.correct ?? false}
              hasPose={pose !== null}
              goalType={goalType}
            />
          </div>

          {lastRep && (
            <p
              className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-stage-300"
              aria-live="polite"
            >
              <span>Last repetition #{lastRep.repNumber}</span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                  lastRep.correct
                    ? 'bg-good-300/15 text-good-300'
                    : 'bg-caution-300/15 text-caution-300'
                }`}
              >
                {lastRep.correct ? 'Good form' : 'Needs attention'}
              </span>
              <span className="type-measure text-stage-400">
                score {lastRep.score.toFixed(0)}/100
              </span>
            </p>
          )}
        </div>

        <div className="space-y-4">
          {isHold ? (
            <HoldCounter
              hold={
                pose?.hold ?? {
                  heldSeconds: ready?.resumedFromHeldSeconds ?? 0,
                  targetSeconds: targetHoldSeconds,
                  remainingSeconds: targetHoldSeconds,
                  progress: 0,
                  active: false,
                  streakSeconds: 0,
                  bestStreakSeconds: 0,
                }
              }
            />
          ) : (
            <RepCounter
              count={repCount}
              target={targetTotal}
              currentSet={pose?.rep.currentSet ?? 1}
              targetSets={ready?.targetSets ?? assignment.targetSets}
            />
          )}
          <TrackingQuality pose={pose} />
          <MovementReadout pose={pose} />

          {ready && !isHold && ready.resumedFromRep > 0 && (
            <p className="rounded-panel border-l-2 border-brand-400 bg-brand-400/10 px-3 py-2 text-xs text-brand-300">
              Resumed from repetition {ready.resumedFromRep} - your earlier
              repetitions were already saved.
            </p>
          )}

          {ready && isHold && ready.resumedFromHeldSeconds > 0 && (
            <p className="rounded-panel border-l-2 border-brand-400 bg-brand-400/10 px-3 py-2 text-xs text-brand-300">
              Resumed with {formatSeconds(ready.resumedFromHeldSeconds)} already
              credited - the time you held earlier was saved.
            </p>
          )}

          {pose && (
            <p className="type-measure text-xs text-stage-400">
              Analysis latency {pose.latencyMs.total.toFixed(0)} ms
              {' · '}
              {sampler.config.fps} fps @ {sampler.config.width}px
            </p>
          )}
        </div>
      </div>

      <PrototypeDisclaimer className="mt-10" onDark />
    </div>
    </Console>
  );
}

/**
 * The dark shell every phase of a session sits inside.
 *
 * Entering a session is a mode change - the camera comes on, the navigation
 * goes away, and the patient is about to stand up and move - so the whole
 * screen changes with it rather than only the part holding the video. The
 * `console` class is what switches the focus ring to a colour that survives on
 * this background.
 */
function Console({
  children,
  bar,
}: {
  children: ReactNode;
  bar?: ReactNode;
}) {
  return (
    <div className="console min-h-full bg-stage text-stage-100">
      {/*
        Wraps rather than scrolls. A phone held in portrait cannot fit the
        exercise name and both session controls on one line, and a session bar
        that runs off the side of the screen takes Cancel and Finish with it.
      */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-stage/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <MoveraMark size="sm" tone="light" />
          {bar ?? (
            <p className="type-display text-[15px] text-white">Session</p>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}

/**
 * Whether frames are actually reaching the analysis service.
 *
 * The pulse is the point. A static dot labelled "live" is a claim; a dot that
 * keeps emitting is evidence, and it is the first thing a patient looks at
 * when they suspect the counter has stopped seeing them.
 */
function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span className="hidden items-center gap-2 rounded-full border border-white/10 px-2.5 py-1 sm:inline-flex">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          connected ? 'animate-live-pulse bg-brand-400' : 'bg-stage-500'
        }`}
      />
      <span className="text-xs font-medium text-stage-300">
        {connected ? 'Live' : 'Standby'}
      </span>
    </span>
  );
}

/**
 * Framing marks over the camera view.
 *
 * Not decoration: the corner brackets show where the analysed frame ends, and
 * the centre line is something to stand on. Both answer the question every
 * patient asks first - "can it see all of me?" - before any landmark has been
 * detected to answer it for them.
 */
function Viewfinder() {
  const corners = [
    'left-3 top-3 border-l-2 border-t-2 rounded-tl-md',
    'right-3 top-3 border-r-2 border-t-2 rounded-tr-md',
    'left-3 bottom-3 border-l-2 border-b-2 rounded-bl-md',
    'right-3 bottom-3 border-r-2 border-b-2 rounded-br-md',
  ];

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {corners.map((position) => (
        <span
          key={position}
          className={`absolute h-6 w-6 border-white/35 ${position}`}
        />
      ))}
      <span className="absolute inset-y-8 left-1/2 w-px -translate-x-1/2 bg-white/10" />
    </div>
  );
}

/**
 * Shown for the moment between the goal being reached and the report loading.
 *
 * It exists so the transition is explained rather than merely fast. The camera
 * has just switched off and the screen is about to change on its own; without
 * a word about why, that reads as a crash. It also states what was achieved,
 * so the accomplishment is acknowledged even if the report is slow.
 *
 * On failure it holds its ground and offers Retry. Completion is idempotent
 * and the session is already stored server-side, so retrying is always safe -
 * and dropping the patient back to a dead camera view would not be.
 */
function SessionCompleteScreen({
  completion,
  error,
  onRetry,
}: {
  completion: SessionClosedData | null;
  error: string | null;
  onRetry: () => void;
}) {
  const isHold = completion?.goalType === 'HOLD';

  return (
    <Console>
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        {/*
          The tick draws itself rather than appearing. It is the one
          celebratory moment in the application and it lasts under a second -
          long enough to register that the work was finished, short enough not
          to stand between a patient and their report.
        */}
        <svg
          viewBox="0 0 54 54"
          width="72"
          height="72"
          fill="none"
          aria-hidden="true"
          className="mx-auto text-good-300"
        >
          <circle
            cx="27"
            cy="27"
            r="25"
            stroke="currentColor"
            strokeWidth="1.5"
            className="draw-in opacity-40"
            style={{
              ['--draw-length' as string]: 158,
              ['--draw-duration' as string]: '900ms',
            }}
          />
          <path
            d="M15 27.5 L 23.5 36 L 39 18"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="draw-in"
            style={{
              ['--draw-length' as string]: 44,
              ['--draw-duration' as string]: '520ms',
              ['--draw-delay' as string]: '260ms',
            }}
          />
        </svg>

        <h1 className="type-display mt-6 text-[30px] leading-tight text-white">
          Session complete
        </h1>

        <p
          className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-stage-300"
          role="status"
          aria-live="polite"
        >
          {completion
            ? isHold
              ? `You held correct alignment for ${formatSeconds(completion.heldSeconds)} of the ${formatSeconds(completion.targetHoldSeconds)} prescribed. Well done.`
              : `You completed all ${completion.totalReps} prescribed repetition${completion.totalReps === 1 ? '' : 's'}. Well done.`
            : 'You finished everything that was prescribed. Well done.'}
        </p>

        {error ? (
          <div className="mt-8 text-left">
            <ErrorState message={error} onRetry={onRetry} />
          </div>
        ) : (
          <p className="mt-8 text-sm text-stage-400">Preparing your report…</p>
        )}
      </div>
    </Console>
  );
}

/**
 * A numbered briefing on the setup screen.
 *
 * The numbers are here because these two steps are genuinely ordered - a
 * patient who frames the camera before reading the movement is framing
 * something they have not seen yet - and not because numbering a list makes it
 * look considered.
 */
function StepHeading({ step, title }: { step: number; title: string }) {
  return (
    <h2 className="flex items-baseline gap-3">
      <span
        className="type-measure shrink-0 text-xs font-semibold text-brand-300"
        aria-hidden="true"
      >
        {step}
      </span>
      <span className="type-display text-[15px] text-white">{title}</span>
    </h2>
  );
}

/** Camera permission and preview, shown before the session starts. */
function CameraStage({
  camera,
  onRetry,
  onContinue,
}: {
  camera: ReturnType<typeof useCamera>;
  onRetry: () => void;
  onContinue: () => void;
}) {
  if (camera.status === 'requesting') {
    return (
      <p
        className="flex items-center gap-2.5 text-sm text-stage-300"
        role="status"
        aria-live="polite"
      >
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-300 border-t-transparent"
          aria-hidden="true"
        />
        Waiting for camera permission. Choose <strong>Allow</strong> when your
        browser asks.
      </p>
    );
  }

  if (camera.status !== 'ready') {
    return (
      <ErrorState
        message={camera.errorMessage ?? 'The camera could not be started.'}
        onRetry={onRetry}
      />
    );
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-stage bg-black shadow-stage ring-1 ring-white/10">
        <video
          ref={camera.attachVideo}
          playsInline
          muted
          autoPlay
          className="block h-auto w-full -scale-x-100"
        />
        <Viewfinder />
      </div>

      {camera.devices.length > 1 && (
        <div className="mt-4 max-w-sm">
          <label
            htmlFor="camera-select"
            className="block text-sm font-medium text-stage-200"
          >
            Camera
          </label>
          <select
            id="camera-select"
            value={camera.activeDeviceId ?? ''}
            onChange={(event) => void camera.switchDevice(event.target.value)}
            className="mt-1 w-full rounded-panel border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white"
          >
            {camera.devices.map((device) => (
              <option
                key={device.deviceId}
                value={device.deviceId}
                className="bg-stage"
              >
                {device.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button size="lg" onClick={onContinue}>
          Start session
        </Button>
        <p className="text-xs text-stage-400">
          Stand where the brackets can see all of you before starting.
        </p>
      </div>
    </div>
  );
}
