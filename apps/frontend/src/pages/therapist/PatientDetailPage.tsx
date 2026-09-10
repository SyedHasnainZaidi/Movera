import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getErrorMessage } from '../../api/client';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  inputClass,
} from '../../components/ui';
import {
  describeAchievement,
  describePrescription,
} from '../../lib/prescription';
import type {
  Assignment,
  ExerciseGoalType,
  Page,
  SessionSummary,
} from '../../types/api';

interface PatientDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  conditionSummary: string | null;
  activePlan: {
    id: string;
    title: string;
    goals: string | null;
    startDate: string;
    endDate: string | null;
  } | null;
}

interface LibraryExercise {
  id: string;
  slug: string;
  name: string;
  defaultSets: number;
  defaultReps: number;
  goalType: ExerciseGoalType;
  /** Null on REPS exercises. */
  defaultHoldSeconds: number | null;
  analysisAvailable: boolean;
}

export function PatientDetailPage() {
  const { patientId = '' } = useParams();
  const queryClient = useQueryClient();

  const patient = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      const { data } = await api.get<PatientDetail>(`/patients/${patientId}`);
      return data;
    },
  });

  const assignments = useQuery({
    queryKey: ['assignments', patientId],
    queryFn: async () => {
      const { data } = await api.get<Assignment[]>(
        `/assignments?patientId=${patientId}`,
      );
      return data;
    },
  });

  const sessions = useQuery({
    queryKey: ['patient', patientId, 'sessions'],
    queryFn: async () => {
      const { data } = await api.get<Page<SessionSummary>>(
        `/patients/${patientId}/sessions?limit=10`,
      );
      return data;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    void queryClient.invalidateQueries({ queryKey: ['assignments', patientId] });
  };

  if (patient.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <LoadingBlock label="Loading patient" />
      </div>
    );
  }

  if (patient.isError || !patient.data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <ErrorState
          message={getErrorMessage(patient.error)}
          onRetry={() => patient.refetch()}
        />
      </div>
    );
  }

  const detail = patient.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-display text-[26px] leading-tight text-ink-900">
            {detail.firstName} {detail.lastName}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {detail.conditionSummary ?? detail.email}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link to={`/therapist/patients/${patientId}/progress`}>
            <Button variant="secondary" size="sm">
              View progress
            </Button>
          </Link>
          <ArchivePatientButton
            patientId={patientId}
            name={`${detail.firstName} ${detail.lastName}`}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PlanCard
          patientId={patientId}
          plan={detail.activePlan}
          onChanged={invalidate}
        />
        <AssignCard
          patientId={patientId}
          planId={detail.activePlan?.id}
          onChanged={invalidate}
        />
      </div>

      <AssignmentsCard
        assignments={assignments.data}
        loading={assignments.isLoading}
        onChanged={invalidate}
      />

      <Card className="mt-6">
        <CardHeader title="Recent sessions" />
        <div className="divide-y divide-ink-100">
          {sessions.isLoading ? (
            <p className="px-5 py-6 text-sm text-ink-500">Loading…</p>
          ) : !sessions.data || sessions.data.data.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-500">
              This patient has not completed any sessions yet.
            </p>
          ) : (
            sessions.data.data.map((session) => (
              <Link
                key={session.id}
                to={`/therapist/sessions/${session.id}/report`}
                className="row-interactive flex items-center justify-between px-5 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    {session.exercise.name}
                  </p>
                  <p className="text-xs text-ink-500">
                    {new Date(session.startedAt).toLocaleString()} ·{' '}
                    {describeAchievement(session)}
                    {/* correctReps is always 0 on a held session. */}
                    {session.goalType !== 'HOLD' &&
                      ` · ${session.correctReps} good`}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink-700">
                  {session.performanceScore?.toFixed(0) ?? '—'}
                </span>
              </Link>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function PlanCard({
  patientId,
  plan,
  onChanged,
}: {
  patientId: string;
  plan: PatientDetail['activePlan'];
  onChanged: () => void;
}) {
  const [title, setTitle] = useState('');
  const [goals, setGoals] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      await api.post('/rehabilitation-plans', {
        patientId,
        title,
        goals: goals || undefined,
        startDate: new Date().toISOString().slice(0, 10),
      });
    },
    onSuccess: () => {
      setTitle('');
      setGoals('');
      onChanged();
    },
  });

  if (plan) {
    return (
      <Card>
        <CardHeader title="Active rehabilitation plan" />
        <div className="p-5">
          <p className="text-sm font-semibold text-ink-900">{plan.title}</p>
          {plan.goals && (
            <p className="mt-2 text-sm leading-relaxed text-ink-700">
              {plan.goals}
            </p>
          )}
          <p className="mt-3 text-xs text-ink-500">
            Started {new Date(plan.startDate).toLocaleDateString()}
          </p>
          <p className="mt-3 text-xs text-ink-500">
            A patient may have only one active plan at a time.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Create a rehabilitation plan"
        description="Required before assigning exercises to a plan"
      />
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <Field label="Plan title" htmlFor="planTitle">
          <input
            id="planTitle"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Lower Limb Rehabilitation - Phase 2"
            className={inputClass}
          />
        </Field>
        <Field label="Goals" htmlFor="planGoals">
          <textarea
            id="planGoals"
            value={goals}
            onChange={(event) => setGoals(event.target.value)}
            rows={3}
            placeholder="Restore knee flexion range and build quadriceps endurance."
            className={inputClass}
          />
        </Field>
        {create.isError && (
          <p className="text-sm text-problem-700" role="alert">
            {getErrorMessage(create.error)}
          </p>
        )}
        <Button type="submit" loading={create.isPending} disabled={!title.trim()}>
          Create plan
        </Button>
      </form>
    </Card>
  );
}

function AssignCard({
  patientId,
  planId,
  onChanged,
}: {
  patientId: string;
  planId?: string;
  onChanged: () => void;
}) {
  const [exerciseId, setExerciseId] = useState('');
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState(10);
  const [holdSeconds, setHoldSeconds] = useState(60);
  const [instructions, setInstructions] = useState('');

  const library = useQuery({
    queryKey: ['exercises'],
    queryFn: async () => {
      const { data } = await api.get<LibraryExercise[]>('/exercises');
      return data.filter((exercise) => exercise.analysisAvailable);
    },
  });

  const selected = library.data?.find((item) => item.id === exerciseId);
  const isHold = selected?.goalType === 'HOLD';

  const assign = useMutation({
    mutationFn: async () => {
      await api.post('/assignments', {
        patientId,
        exerciseId,
        planId,
        // Sets and reps are still sent for a HOLD exercise because the columns
        // are NOT NULL, but the backend stores holdSeconds as the prescription
        // and ignores them. Sending 1x1 rather than the form's leftover 3x10
        // keeps the stored row from implying a repetition target nobody set.
        targetSets: isHold ? 1 : sets,
        repsPerSet: isHold ? 1 : reps,
        holdSeconds: isHold ? holdSeconds : undefined,
        instructions: instructions || undefined,
        startDate: new Date().toISOString().slice(0, 10),
      });
    },
    onSuccess: () => {
      setExerciseId('');
      setInstructions('');
      onChanged();
    },
  });

  return (
    <Card>
      <CardHeader
        title="Assign an exercise"
        description="Only exercises with pose analysis configured are listed"
      />
      <form
        className="space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (exerciseId) assign.mutate();
        }}
      >
        <Field label="Exercise" htmlFor="exercise">
          <select
            id="exercise"
            value={exerciseId}
            onChange={(event) => {
              setExerciseId(event.target.value);
              const chosen = library.data?.find(
                (item) => item.id === event.target.value,
              );
              if (chosen) {
                setSets(chosen.defaultSets);
                setReps(chosen.defaultReps);
                if (chosen.defaultHoldSeconds != null) {
                  setHoldSeconds(chosen.defaultHoldSeconds);
                }
              }
            }}
            className={inputClass}
          >
            <option value="">Choose an exercise…</option>
            {library.data?.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>
                {exercise.name}
              </option>
            ))}
          </select>
        </Field>

        {/*
          A held-position exercise has no repetitions to prescribe. Asking for
          sets and reps anyway would invite a therapist to set a target the
          session will never measure.
        */}
        {isHold ? (
          <Field
            label="Hold for"
            htmlFor="holdSeconds"
            hint="Seconds of correct alignment to accumulate. The patient does not have to hold it all in one go, and the session ends itself once the total is reached."
          >
            <input
              id="holdSeconds"
              type="number"
              min={5}
              max={1800}
              step={5}
              value={holdSeconds}
              onChange={(event) => setHoldSeconds(Number(event.target.value))}
              className={inputClass}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sets" htmlFor="sets">
              <input
                id="sets"
                type="number"
                min={1}
                max={20}
                value={sets}
                onChange={(event) => setSets(Number(event.target.value))}
                className={inputClass}
              />
            </Field>
            <Field
              label="Reps per set"
              htmlFor="reps"
              hint={`Total: ${sets * reps} repetitions`}
            >
              <input
                id="reps"
                type="number"
                min={1}
                max={100}
                value={reps}
                onChange={(event) => setReps(Number(event.target.value))}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        <Field label="Instructions (optional)" htmlFor="instructions">
          <textarea
            id="instructions"
            rows={2}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Keep your heels flat and pause at the bottom."
            className={inputClass}
          />
        </Field>

        {assign.isError && (
          <p className="text-sm text-problem-700" role="alert">
            {getErrorMessage(assign.error)}
          </p>
        )}
        {assign.isSuccess && (
          <p className="text-sm text-good-700" role="status">
            Exercise assigned. The patient has been notified.
          </p>
        )}

        <Button type="submit" loading={assign.isPending} disabled={!exerciseId}>
          Assign exercise
        </Button>
      </form>
    </Card>
  );
}

/**
 * Discharge a patient from the caseload.
 *
 * Ends the therapist-patient link rather than deleting anything. Every plan,
 * assignment, session and report stays in the database attached to the
 * patient, and the link ROW itself is kept so a returning patient reconnects
 * to the same record instead of starting a blank one beside it.
 *
 * The confirmation is explicit that access ENDS. That is the part a therapist
 * needs to know before pressing it: the record becomes unreadable to them
 * until the patient shares a new invite code. It comes back on re-link, but it
 * is not theirs to read in the meantime.
 */
function ArchivePatientButton({
  patientId,
  name,
}: {
  patientId: string;
  name: string;
}) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archive = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete<{ message: string }>(
        `/therapists/me/patients/${patientId}`,
      );
      return data;
    },
    onSuccess: () => {
      // Back to the caseload: this patient is no longer readable, so staying
      // on their page would only render errors.
      navigate('/therapist/patients', { replace: true });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  if (!confirming) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
        Archive patient
      </Button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label={`Archive ${name}`}
      className="w-full rounded-lg border border-problem-500/30 bg-problem-50 px-4 py-3"
    >
      <p className="text-sm font-medium text-problem-700">Archive {name}?</p>
      <p className="mt-1 text-sm text-ink-700">
        Their plans, exercises, sessions and reports are all kept — nothing is
        deleted. They move to your archived patients, and{' '}
        <strong>you lose access to their records</strong> until they share a new
        invite code. If they come back, the link and the full history return
        with them.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          size="sm"
          loading={archive.isPending}
          onClick={() => archive.mutate()}
        >
          Archive patient
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={archive.isPending}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-problem-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The prescribed-exercise list, split into current and archived.
 *
 * Archived assignments are kept - they carry completed sessions and reports -
 * but they are not what a therapist is looking at day to day. Leaving them in
 * the main list would mean "removing" an old exercise still left it on screen,
 * which is most of the reason to remove one. They collapse into a count that
 * can be opened when the history is actually wanted.
 */
function AssignmentsCard({
  assignments,
  loading,
  onChanged,
}: {
  assignments: Assignment[] | undefined;
  loading: boolean;
  onChanged: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);

  const current = (assignments ?? []).filter(
    (a) => (a.status ?? 'ACTIVE') !== 'CANCELLED',
  );
  const archived = (assignments ?? []).filter(
    (a) => a.status === 'CANCELLED',
  );

  return (
    <Card className="mt-6">
      <CardHeader
        title="Assigned exercises"
        description={
          current.length > 0
            ? `${current.length} current${
                archived.length > 0 ? ` · ${archived.length} archived` : ''
              }`
            : undefined
        }
      />
      <div className="divide-y divide-ink-100">
        {loading ? (
          <p className="px-5 py-6 text-sm text-ink-500">Loading…</p>
        ) : current.length === 0 && archived.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No exercises assigned"
              description="Use the panel above to prescribe an exercise."
            />
          </div>
        ) : (
          <>
            {current.length === 0 && (
              <p className="px-5 py-6 text-sm text-ink-500">
                No current exercises. Prescribe one above, or reopen an
                archived exercise below.
              </p>
            )}
            {current.map((assignment) => (
              <AssignmentRow
                key={assignment.id}
                assignment={assignment}
                onChanged={onChanged}
              />
            ))}

            {archived.length > 0 && (
              <div className="bg-sunken">
                <button
                  type="button"
                  onClick={() => setShowArchived((open) => !open)}
                  aria-expanded={showArchived}
                  className="w-full px-5 py-3 text-left text-sm font-medium text-ink-600 hover:text-ink-900"
                >
                  {showArchived ? '▾' : '▸'} {archived.length} archived exercise
                  {archived.length === 1 ? '' : 's'}
                  <span className="ml-2 font-normal text-ink-500">
                    history kept, not startable
                  </span>
                </button>
                {showArchived && (
                  <div className="divide-y divide-ink-200 border-t border-ink-200">
                    {archived.map((assignment) => (
                      <AssignmentRow
                        key={assignment.id}
                        assignment={assignment}
                        onChanged={onChanged}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * One prescribed exercise, with the actions a therapist needs to manage it.
 *
 * Three states matter:
 *   ACTIVE    - the patient can start it, repeatedly. Can be paused or removed.
 *   PAUSED    - temporarily stopped. Resuming lets the patient run FURTHER
 *               sessions on this same assignment; a duplicate prescription is
 *               never needed just to give them another go.
 *   CANCELLED - archived. Read-only history.
 */
function AssignmentRow({
  assignment,
  onChanged,
}: {
  assignment: Assignment;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = assignment.status ?? 'ACTIVE';
  const sessionCount = assignment.sessionCount ?? 0;
  const hasHistory = sessionCount > 0;
  const isArchived = status === 'CANCELLED';

  const setStatus = useMutation({
    mutationFn: async (next: 'ACTIVE' | 'PAUSED') => {
      await api.patch(`/assignments/${assignment.id}`, { status: next });
    },
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { data } = await api.delete<{ message: string }>(
        `/assignments/${assignment.id}`,
      );
      return data;
    },
    onSuccess: () => {
      setError(null);
      setConfirming(false);
      onChanged();
    },
    onError: (err) => {
      setError(getErrorMessage(err));
      setConfirming(false);
    },
  });

  const busy = setStatus.isPending || remove.isPending;

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink-900">
              {assignment.exercise?.name}
            </p>
            <Badge
              tone={
                status === 'ACTIVE'
                  ? 'good'
                  : status === 'PAUSED'
                    ? 'caution'
                    : 'neutral'
              }
            >
              {status.toLowerCase()}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            {describePrescription(assignment)}
            {assignment.scheduledDays.length > 0 &&
              ` · ${assignment.scheduledDays.map(dayName).join(', ')}`}
            {assignment.sessionCount != null &&
              ` · ${sessionCount} session${sessionCount === 1 ? '' : 's'} recorded`}
          </p>
        </div>

        {/*
          An archived assignment can be reopened. Archiving is a decision a
          therapist may reverse - the patient picks up the SAME assignment,
          keeping its history in one place, rather than being given a duplicate
          prescription that splits their record in two.
        */}
        {isArchived && (
          <Button
            variant="secondary"
            size="sm"
            loading={setStatus.isPending}
            disabled={busy}
            onClick={() => setStatus.mutate('ACTIVE')}
          >
            Reopen
          </Button>
        )}

        {!isArchived && !confirming && (
          <div className="flex shrink-0 gap-2">
            {status === 'ACTIVE' ? (
              <Button
                variant="secondary"
                size="sm"
                loading={setStatus.isPending}
                disabled={busy}
                onClick={() => setStatus.mutate('PAUSED')}
              >
                Pause
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                loading={setStatus.isPending}
                disabled={busy}
                onClick={() => setStatus.mutate('ACTIVE')}
              >
                Resume
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Remove
            </Button>
          </div>
        )}
      </div>

      {confirming && (
        <div
          role="alertdialog"
          aria-label={`Remove ${assignment.exercise?.name}`}
          className="mt-3 rounded-lg border border-problem-500/30 bg-problem-50 px-4 py-3"
        >
          {/*
            The wording is driven by sessionCount, because the two outcomes are
            genuinely different and promising a deletion that will not happen
            would be a lie the therapist acts on.
          */}
          <p className="text-sm font-medium text-problem-700">
            {hasHistory
              ? `Archive "${assignment.exercise?.name}"?`
              : `Delete "${assignment.exercise?.name}"?`}
          </p>
          <p className="mt-1 text-sm text-ink-700">
            {hasHistory
              ? `This exercise has ${sessionCount} recorded session${
                  sessionCount === 1 ? '' : 's'
                }. That history is kept and stays readable in reports - the ` +
                `exercise is archived so the patient can no longer start it.`
              : 'It has no recorded sessions, so it is deleted outright. Nothing is kept.'}
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {hasHistory ? 'Archive it' : 'Delete it'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={remove.isPending}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-problem-700">
          {error}
        </p>
      )}
    </div>
  );
}

function dayName(iso: number): string {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][iso - 1] ?? '?';
}
