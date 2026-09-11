import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../../api/client';
import { Reveal } from '../../components/motion';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  PrototypeDisclaimer,
} from '../../components/ui';
import { describePrescription } from '../../lib/prescription';
import type {
  Assignment,
  PlanStatus,
  RehabilitationPlan,
} from '../../types/api';

/**
 * The patient's plans, with their exercises nested underneath.
 *
 * This replaces a flat list of every prescribed exercise. That list was
 * accurate but gave no structure: a patient with three exercises across two
 * phases of treatment saw five equal rows and no indication of what belonged
 * to what, or which course of treatment was current. Grouping by plan restores
 * the shape the therapist actually prescribed in - a plan states the goal, and
 * the exercises under it are how that goal is pursued.
 *
 * Two queries rather than one endpoint: the plan list carries the goals, dates
 * and status, and the assignment list carries the prescription detail needed
 * to start a session. They are joined here on planId.
 */
export function MyPlansPage() {
  const plans = useQuery({
    queryKey: ['plans', 'me'],
    queryFn: async () => {
      const { data } = await api.get<RehabilitationPlan[]>(
        '/rehabilitation-plans',
      );
      return data;
    },
  });

  const assignments = useQuery({
    queryKey: ['assignments', 'me'],
    queryFn: async () => {
      const { data } = await api.get<Assignment[]>('/assignments');
      return data;
    },
  });

  const isLoading = plans.isLoading || assignments.isLoading;
  const isError = plans.isError || assignments.isError;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <LoadingBlock label="Loading your plans" />
      </div>
    );
  }

  if (isError || !plans.data || !assignments.data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <ErrorState
          message={getErrorMessage(plans.error ?? assignments.error)}
          onRetry={() => {
            void plans.refetch();
            void assignments.refetch();
          }}
        />
      </div>
    );
  }

  const byPlan = new Map<string, Assignment[]>();
  const unplanned: Assignment[] = [];
  for (const assignment of assignments.data) {
    // CANCELLED assignments are history, not something to show a patient as
    // part of their programme. The therapist can still see them.
    if (assignment.status === 'CANCELLED') continue;
    const key = assignment.planId ?? assignment.plan?.id ?? null;
    if (key === null) {
      unplanned.push(assignment);
      continue;
    }
    const existing = byPlan.get(key);
    if (existing) existing.push(assignment);
    else byPlan.set(key, [assignment]);
  }

  const current = plans.data.filter((plan) => plan.status === 'ACTIVE');
  const past = plans.data.filter((plan) => plan.status !== 'ACTIVE');

  const nothingAtAll =
    current.length === 0 && past.length === 0 && unplanned.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Reveal>
        <PageHeader
          title="My plans"
          description="Your courses of treatment and the exercises in each"
        />
      </Reveal>

      {nothingAtAll ? (
        <div className="mt-6">
          <EmptyState
            title="No plan yet"
            description="Your physiotherapist has not created a rehabilitation plan for you yet. When they do, it will appear here with the exercises to work through."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {current.map((plan, index) => (
            <PlanSection
              key={plan.id}
              plan={plan}
              assignments={byPlan.get(plan.id) ?? []}
              revealIndex={index}
            />
          ))}

          {unplanned.length > 0 && (
            <UnplannedSection
              assignments={unplanned}
              revealIndex={current.length}
            />
          )}

          {past.length > 0 && (
            <section>
              <h2 className="mt-8 text-sm font-semibold text-ink-600">
                Past plans
              </h2>
              <p className="mt-0.5 text-sm text-ink-500">
                Kept for your records. Your sessions and reports from these are
                still in your history.
              </p>
              <div className="mt-3 space-y-4">
                {past.map((plan, index) => (
                  <PlanSection
                    key={plan.id}
                    plan={plan}
                    assignments={byPlan.get(plan.id) ?? []}
                    revealIndex={index}
                    muted
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <PrototypeDisclaimer className="mt-8" />
    </div>
  );
}

const PLAN_TONE: Record<
  PlanStatus,
  'good' | 'neutral' | 'brand' | 'caution'
> = {
  ACTIVE: 'good',
  DRAFT: 'caution',
  COMPLETED: 'brand',
  CANCELLED: 'neutral',
};

const PLAN_LABEL: Record<PlanStatus, string> = {
  ACTIVE: 'Active',
  DRAFT: 'Draft',
  COMPLETED: 'Completed',
  CANCELLED: 'Ended',
};

/**
 * One plan and everything prescribed under it.
 *
 * The plan header carries the goal, because that is the answer to "why am I
 * doing these": the exercises below it are the means. A muted section is a
 * finished or ended plan - still readable, visibly not current, and with no
 * way to start anything.
 */
function PlanSection({
  plan,
  assignments,
  revealIndex,
  muted = false,
}: {
  plan: RehabilitationPlan;
  assignments: Assignment[];
  revealIndex: number;
  muted?: boolean;
}) {
  return (
    <Card revealIndex={revealIndex} className={muted ? 'opacity-80' : ''}>
      <div className="border-b border-ink-100 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="type-display text-[17px] text-ink-900">
                {plan.title}
              </h2>
              <Badge tone={PLAN_TONE[plan.status]}>
                {PLAN_LABEL[plan.status]}
              </Badge>
            </div>
            {plan.goals && (
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-700">
                {plan.goals}
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Started {new Date(plan.startDate).toLocaleDateString()}
          {plan.endDate &&
            ` · ends ${new Date(plan.endDate).toLocaleDateString()}`}
          {plan.therapistName && ` · ${plan.therapistName}`}
        </p>
      </div>

      {assignments.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">
          {muted
            ? 'No exercises were recorded under this plan.'
            : 'No exercises have been added to this plan yet. Your physiotherapist will add them.'}
        </p>
      ) : (
        <>
          <p className="px-5 pt-4 text-xs font-semibold tracking-wide text-ink-500 uppercase">
            {assignments.length} exercise{assignments.length === 1 ? '' : 's'}
          </p>
          <ul className="divide-y divide-ink-100">
            {assignments.map((assignment) => (
              <li key={assignment.id}>
                <ExerciseRow assignment={assignment} startable={!muted} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/**
 * Exercises with no plan behind them.
 *
 * Only rows that predate the rule requiring a plan. They are shown rather than
 * hidden because they are still work the patient was told to do, and silently
 * dropping them from this page would take exercises away from someone who is
 * mid-programme.
 */
function UnplannedSection({
  assignments,
  revealIndex,
}: {
  assignments: Assignment[];
  revealIndex: number;
}) {
  return (
    <Card revealIndex={revealIndex}>
      <div className="border-b border-ink-100 p-5">
        <h2 className="type-display text-[17px] text-ink-900">
          Other exercises
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-700">
          Prescribed to you before your physiotherapist started grouping
          exercises into plans. They work exactly the same way.
        </p>
      </div>
      <ul className="divide-y divide-ink-100">
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            <ExerciseRow assignment={assignment} startable />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * One prescribed exercise.
 *
 * A paused assignment keeps its row but loses its button: the therapist has
 * stopped it deliberately, and offering a control that the API would refuse
 * would be worse than saying plainly that it is paused.
 */
function ExerciseRow({
  assignment,
  startable,
}: {
  assignment: Assignment;
  startable: boolean;
}) {
  const paused = assignment.status === 'PAUSED';

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold text-ink-900">
            {assignment.exercise?.name}
          </h3>
          {paused && <Badge tone="caution">Paused</Badge>}
        </div>
        <p className="mt-1 text-sm text-ink-600">
          {describePrescription(assignment)}
        </p>
        {assignment.instructions && (
          <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
            {assignment.instructions}
          </p>
        )}
      </div>

      {startable && !paused && (
        <Link to={`/patient/session/${assignment.id}`} className="shrink-0">
          <Button>Start session</Button>
        </Link>
      )}
    </div>
  );
}
