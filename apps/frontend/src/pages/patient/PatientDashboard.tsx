import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../../api/client';
import { Reveal } from '../../components/motion';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  RowArrow,
  StatStrip,
} from '../../components/ui';
import {
  describeAchievement,
  describePrescription,
} from '../../lib/prescription';
import { useAuthStore } from '../../stores/authStore';
import type {
  Assignment,
  PatientDashboard as DashboardData,
} from '../../types/api';

export function PatientDashboardPage() {
  const user = useAuthStore((state) => state.user);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient', 'dashboard'],
    queryFn: async () => {
      const { data } = await api.get<DashboardData>('/patients/me/dashboard');
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <LoadingBlock label="Loading your dashboard" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <ErrorState message={getErrorMessage(error)} onRetry={() => refetch()} />
      </div>
    );
  }

  const today = data.assignments.filter((a) => a.scheduledToday);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Reveal>
        <PageHeader
          title={`Hello, ${user?.firstName}`}
          description={
            today.length > 0
              ? `You have ${today.length} exercise${today.length === 1 ? '' : 's'} scheduled today.`
              : 'Nothing is scheduled for today. You can still practise any assigned exercise.'
          }
        />
      </Reveal>

      {/*
        What to do now, before anything about what was done before.

        A patient opens this page to exercise, not to read statistics, so the
        prescription for today leads and the totals follow. It is the only
        block on a light page drawn on the dark ground of the session console -
        the surface where exercising happens - so the route from here into a
        session is visible before any of it is read.
      */}
      <Reveal index={1}>
        <TodayPanel assignments={today} />
      </Reveal>

      <Reveal index={2}>
        <StatStrip
          reveal={false}
          className="mt-6"
          items={[
            {
              label: 'Sessions',
              value: data.stats.totalSessions,
              countTo: data.stats.totalSessions,
            },
            {
              label: 'Average form score',
              value: data.stats.averageScore ?? '—',
              hint: 'Out of 100',
              meter:
                data.stats.averageScore !== null
                  ? data.stats.averageScore / 100
                  : undefined,
              tone: 'brand',
            },
            {
              label: 'Repetitions',
              value: data.stats.totalReps,
              countTo: data.stats.totalReps,
              hint: `${data.stats.correctReps} met the form criteria`,
              meter:
                data.stats.totalReps > 0
                  ? data.stats.correctReps / data.stats.totalReps
                  : undefined,
              tone: 'good',
            },
            { label: 'Active exercises', value: data.stats.activeAssignments },
          ]}
        />
      </Reveal>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Reveal index={3}>
          <Card reveal={false}>
            <CardHeader
              title="Your exercises"
              description="Prescribed by your physiotherapist"
            />
            <div className="divide-y divide-ink-100">
              {data.assignments.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No exercises yet"
                    description="Once a physiotherapist is linked to your account and prescribes exercises, they will appear here."
                    action={
                      <Link to="/patient/therapist">
                        <Button variant="secondary" size="sm">
                          Link a physiotherapist
                        </Button>
                      </Link>
                    }
                  />
                </div>
              ) : (
                data.assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-ink-900">
                          {assignment.exercise.name}
                        </h3>
                        {assignment.scheduledToday && (
                          <Badge tone="brand">Today</Badge>
                        )}
                      </div>
                      <p className="type-measure mt-0.5 text-sm text-ink-500">
                        {describePrescription(assignment)}
                        {' · '}
                        {assignment.exercise.targetBodyArea}
                      </p>
                    </div>
                    <Link to={`/patient/session/${assignment.id}`}>
                      <Button size="sm">Start</Button>
                    </Link>
                  </div>
                ))
              )}
            </div>
          </Card>
        </Reveal>

        <div className="space-y-6">
          <Reveal index={4}>
            <Card reveal={false}>
              <CardHeader
                title="Recent sessions"
                action={
                  <Link
                    to="/patient/sessions"
                    className="link-underline text-sm font-medium text-brand-700"
                  >
                    View all
                  </Link>
                }
              />
              <div className="divide-y divide-ink-100">
                {data.recentSessions.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-ink-500">
                    Your completed sessions will be listed here.
                  </p>
                ) : (
                  data.recentSessions.map((session) => (
                    <Link
                      key={session.id}
                      to={`/patient/sessions/${session.id}/report`}
                      className="row-interactive flex items-center gap-3 px-5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-900">
                          {session.exercise.name}
                        </p>
                        <p className="type-measure text-xs text-ink-500">
                          {new Date(session.startedAt).toLocaleDateString()} ·{' '}
                          {describeAchievement(session)}
                        </p>
                      </div>
                      <span className="type-measure text-sm font-semibold text-ink-700">
                        {session.performanceScore?.toFixed(0) ?? '—'}
                      </span>
                      <RowArrow />
                    </Link>
                  ))
                )}
              </div>
            </Card>
          </Reveal>

          <Reveal index={5}>
            <Card reveal={false}>
              <CardHeader title="Therapist feedback" />
              <div className="divide-y divide-ink-100">
                {data.recentFeedback.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-ink-500">
                    No feedback yet.
                  </p>
                ) : (
                  data.recentFeedback.map((item) => (
                    /*
                     * Set as a quotation, because it is one. A note written by
                     * a named person about this patient's own work should not
                     * look like another row of system output.
                     */
                    <figure key={item.id} className="m-0 px-5 py-4">
                      <blockquote className="border-l-2 border-brand-200 pl-3 text-sm leading-relaxed text-ink-800">
                        {item.body}
                      </blockquote>
                      <figcaption className="mt-2 pl-3 text-xs text-ink-500">
                        {item.therapistName} ·{' '}
                        {new Date(item.createdAt).toLocaleDateString()}
                      </figcaption>
                    </figure>
                  ))
                )}
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

/**
 * Today's prescription, or an honest statement that there is none.
 *
 * Each exercise is a whole card that is one action, so it lifts to meet the
 * pointer and settles under a press - on a phone propped across the room, the
 * target is the card rather than a button inside it.
 */
function TodayPanel({ assignments }: { assignments: Assignment[] }) {
  if (assignments.length === 0) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-card border border-dashed border-ink-300 px-5 py-4">
        <div>
          <h2 className="type-display text-[15px] text-ink-800">
            Nothing scheduled today
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Rest days are part of the programme. Any assigned exercise can still
            be practised.
          </p>
        </div>
        <Link to="/patient/exercises">
          <Button variant="secondary" size="sm">
            Browse my exercises
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <section className="mt-6 overflow-hidden rounded-card bg-stage shadow-panel ring-1 ring-white/10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-5">
        <h2 className="type-display text-[17px] text-white">Today</h2>
        <p className="text-sm text-stage-400">
          {assignments.length} exercise{assignments.length === 1 ? '' : 's'} to
          do
        </p>
      </div>

      <ul className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            <Link
              to={`/patient/session/${assignment.id}`}
              className="lift group flex h-full flex-col justify-between gap-4 rounded-panel border border-white/10 bg-white/[0.05] p-4 hover:border-white/20 hover:bg-white/[0.08]"
            >
              <div>
                <h3 className="type-display text-[15px] text-white">
                  {assignment.exercise.name}
                </h3>
                <p className="type-measure mt-1 text-sm text-stage-300">
                  {describePrescription(assignment)}
                </p>
                <p className="mt-0.5 text-xs capitalize text-stage-400">
                  {assignment.exercise.targetBodyArea}
                </p>
              </div>

              {/*
                Not a nested button: the whole card is the link, and a button
                inside it would be a second control for the same action that
                a keyboard has to tab past.
              */}
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-300">
                Start
                <svg
                  viewBox="0 0 16 16"
                  width="15"
                  height="15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="transition-transform duration-[260ms] ease-[cubic-bezier(0.16,0.84,0.44,1)] group-hover:translate-x-1"
                >
                  <path d="M3 8 H 12 M8.5 4 L 12.5 8 L 8.5 12" />
                </svg>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
