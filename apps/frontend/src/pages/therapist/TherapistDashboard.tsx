import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../../api/client';
import { Reveal } from '../../components/motion';
import {
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
import { describeAchievement } from '../../lib/prescription';
import { useAuthStore } from '../../stores/authStore';
import type { TherapistDashboard as DashboardData } from '../../types/api';

export function TherapistDashboardPage() {
  const user = useAuthStore((state) => state.user);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['therapist', 'dashboard'],
    queryFn: async () => {
      const { data } = await api.get<DashboardData>('/therapists/me/dashboard');
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <LoadingBlock label="Loading your caseload" />
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Reveal>
        <PageHeader
          title={`Good day, ${user?.firstName}`}
          description={`${data.caseload} patient${data.caseload === 1 ? '' : 's'} under your care`}
          action={
            <Link to="/therapist/patients">
              <Button size="sm">Manage patients</Button>
            </Link>
          }
        />
      </Reveal>

      {/*
        Who needs this therapist, before anything about the caseload in
        aggregate.

        The mirror of the patient's Today panel, and the same reasoning: the
        first thing on a home page should be the thing the reader came to act
        on. A therapist opening this screen is deciding who to look at next,
        not reading their own averages - so the patients who have stopped
        exercising lead, on the same dark ground that marks a route into work.
      */}
      <Reveal index={1}>
        <NeedsAttentionPanel
          patients={data.patientsNeedingReview}
          sessionsThisWeek={data.sessionsThisWeek}
          caseload={data.caseload}
        />
      </Reveal>

      <Reveal index={2}>
        <StatStrip
          reveal={false}
          className="mt-6"
          items={[
            {
              label: 'Patients',
              value: data.caseload,
              countTo: data.caseload,
            },
            { label: 'Active plans', value: data.activePlans },
            {
              label: 'Sessions this week',
              value: data.sessionsThisWeek,
              countTo: data.sessionsThisWeek,
              hint: `${data.activeAssignments} active assignments`,
            },
            {
              label: 'Average form score',
              value: data.averageScore?.toFixed(1) ?? '—',
              hint: 'Across all completed sessions',
              meter:
                data.averageScore !== null && data.averageScore !== undefined
                  ? data.averageScore / 100
                  : undefined,
              tone: 'brand',
            },
          ]}
        />
      </Reveal>

      {data.caseload === 0 && (
        <Reveal index={3} className="mt-8">
          <EmptyState
            title="No patients linked yet"
            description="Ask a patient to generate an invite code from their account, then enter it to connect."
            action={
              <Link to="/therapist/patients">
                <Button size="sm">Link a patient</Button>
              </Link>
            }
          />
        </Reveal>
      )}

      {/*
        Full width, and no second column.

        The right-hand card here used to repeat the patients needing review,
        which are now the panel at the top of the page. Listing the same four
        names twice on one screen makes a therapist check whether they are the
        same four.
      */}
      <div className="mt-8">
        <Reveal index={3}>
          <Card reveal={false}>
            <CardHeader
              title="Recent sessions"
              description="Completed by your patients"
            />
            <div className="divide-y divide-ink-100">
              {data.recentSessions.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-500">
                  No completed sessions yet.
                </p>
              ) : (
                data.recentSessions.map((session) => (
                  <Link
                    key={session.sessionId}
                    to={`/therapist/sessions/${session.sessionId}/report`}
                    className="row-interactive flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {session.patientName}
                      </p>
                      <p className="type-measure text-xs text-ink-500">
                        {session.exercise} ·{' '}
                        {new Date(session.startedAt).toLocaleDateString()} ·{' '}
                        {describeAchievement(session)}
                      </p>
                    </div>
                    <span className="type-measure shrink-0 text-sm font-semibold text-ink-700">
                      {session.performanceScore?.toFixed(0) ?? '—'}
                    </span>
                    <RowArrow />
                  </Link>
                ))
              )}
            </div>
          </Card>
        </Reveal>

      </div>
    </div>
  );
}

/**
 * The patients who have stopped exercising.
 *
 * Deliberately the loudest thing on the page, because it is the only thing on
 * it that decays: a caseload average is still true tomorrow, a patient who has
 * not exercised in a week is more overdue tomorrow than they are today.
 *
 * The rule behind it is named in the panel rather than buried in a tooltip.
 * "Needs review" arrived at by counting days since the last session is a very
 * different claim from one arrived at by a model, and a therapist has to be
 * able to tell which they are being shown.
 */
function NeedsAttentionPanel({
  patients,
  sessionsThisWeek,
  caseload,
}: {
  patients: { patientProfileId: string; name: string; reason: string }[];
  sessionsThisWeek: number;
  caseload: number;
}) {
  if (caseload === 0) return null;

  if (patients.length === 0) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-card border border-dashed border-ink-300 px-5 py-4">
        <div>
          <h2 className="type-display text-[15px] text-ink-800">
            Everyone is up to date
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Every patient has exercised in the last week
            {sessionsThisWeek > 0
              ? `, across ${sessionsThisWeek} session${sessionsThisWeek === 1 ? '' : 's'}.`
              : '.'}
          </p>
        </div>
        <Link to="/therapist/patients">
          <Button variant="secondary" size="sm">
            View caseload
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <section className="mt-6 overflow-hidden rounded-card bg-stage shadow-panel ring-1 ring-white/10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-5">
        <h2 className="type-display text-[17px] text-white">Needs attention</h2>
        <p className="text-sm text-stage-400">
          No session in the last 7 days · counted, not predicted
        </p>
      </div>

      <ul className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {patients.map((patient) => (
          <li key={patient.patientProfileId}>
            <Link
              to={`/therapist/patients/${patient.patientProfileId}`}
              className="lift group flex h-full flex-col justify-between gap-4 rounded-panel border border-white/10 bg-white/[0.05] p-4 hover:border-white/20 hover:bg-white/[0.08]"
            >
              <div>
                <h3 className="type-display text-[15px] text-white">
                  {patient.name}
                </h3>
                <p className="mt-1 text-sm text-stage-300">{patient.reason}</p>
              </div>

              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-300">
                Open record
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
