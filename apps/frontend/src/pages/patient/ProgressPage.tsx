import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, getErrorMessage } from '../../api/client';
import { Reveal, usePrefersReducedMotion } from '../../components/motion';
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatStrip,
} from '../../components/ui';
import { useThemeStore } from '../../stores/themeStore';
import type { ProgressData } from '../../types/api';

/**
 * Chart colours, per theme.
 *
 * Recharts sets `stroke` and `fill` as SVG attributes, so it cannot read a
 * Tailwind class and cannot follow a CSS variable that changes underneath it.
 * These are the only literal hex values left in the application; each is named
 * after the token it mirrors so a palette change has one obvious place to
 * follow.
 *
 * The two series are told apart by DASH PATTERN as well as by colour, and the
 * caption under the chart names which is which - so the chart is still
 * readable without relying on the difference between teal and indigo.
 */
const CHART_THEMES = {
  light: {
    grid: '#e9efed', // ink-100
    axis: '#5e706c', // ink-500
    axisLine: '#d4dedb', // ink-200
    score: '#2b7f76', // brand-500
    completion: '#4a5fa5', // accent-500
    tooltipBg: '#ffffff', // surface
    tooltipText: '#17201f', // ink-900
  },
  dark: {
    grid: '#26322f',
    axis: '#94a29e',
    axisLine: '#35433f',
    score: '#6cb5aa',
    completion: '#93a5da',
    tooltipBg: '#171f1e',
    tooltipText: '#f0f4f3',
  },
} as const;

/**
 * Progress over time.
 *
 * Everything here is a count or an average over stored sessions. The
 * methodology note from the API is rendered verbatim so the screen cannot
 * imply these are model predictions - they are not, and calling them "AI"
 * would be false.
 */
export function ProgressPage({ patientId }: { patientId?: string }) {
  const path = patientId
    ? `/patients/${patientId}/progress`
    : '/patients/me/progress';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['progress', patientId ?? 'me'],
    queryFn: async () => {
      const { data } = await api.get<ProgressData>(path);
      return data;
    },
  });

  // Read before the early returns, so the hook order is the same on the
  // loading, error and loaded renders.
  const reducedMotion = usePrefersReducedMotion();
  const theme = useThemeStore((state) => state.theme);
  const CHART = CHART_THEMES[theme];

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <LoadingBlock label="Loading progress" />
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

  if (data.timeline.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader title="Progress" />
        <div className="mt-6">
          <EmptyState
            title="No completed sessions yet"
            description="Progress charts appear once at least one exercise session has been completed."
          />
        </div>
      </div>
    );
  }

  const chartData = data.timeline.map((point, index) => ({
    index: index + 1,
    date: new Date(point.date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }),
    score: point.performanceScore,
    completion: point.completionRatio,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Reveal>
        <PageHeader
          title="Progress"
          description={`${data.summary.totalSessions} completed session${
            data.summary.totalSessions === 1 ? '' : 's'
          }${
            data.summary.firstSessionAt
              ? ` since ${new Date(data.summary.firstSessionAt).toLocaleDateString()}`
              : ''
          }`}
        />
      </Reveal>

      <Reveal index={1}>
        <StatStrip
          reveal={false}
          className="mt-6"
          items={[
            {
              label: 'Average form score',
              value: data.summary.averageScore?.toFixed(1) ?? '—',
              hint: 'Out of 100',
              meter:
                data.summary.averageScore !== null &&
                data.summary.averageScore !== undefined
                  ? data.summary.averageScore / 100
                  : undefined,
              tone: 'brand',
            },
            { label: 'Total repetitions', value: data.summary.totalReps },
            {
              label: 'Good form',
              value: `${data.summary.correctRepRatio}%`,
              hint: `${data.summary.correctReps} of ${data.summary.totalReps}`,
              meter: data.summary.correctRepRatio / 100,
              tone: 'good',
            },
            { label: 'Sessions', value: data.summary.totalSessions },
          ]}
        />
      </Reveal>

      <Reveal index={2} className="mt-6 block">
      <Card reveal={false}>
        <CardHeader
          title="Form score over time"
          description="Each point is one completed session"
        />
        <div className="p-5">
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart
                data={chartData}
                margin={{ top: 8, right: 12, bottom: 8, left: -12 }}
              >
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: CHART.axis, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: CHART.axisLine }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: CHART.axis, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ stroke: CHART.axisLine, strokeWidth: 1 }}
                  contentStyle={{
                    borderRadius: 10,
                    border: `1px solid ${CHART.axisLine}`,
                    backgroundColor: CHART.tooltipBg,
                    color: CHART.tooltipText,
                    boxShadow: '0 6px 16px -6px rgb(0 0 0 / 0.35)',
                    fontSize: 13,
                  }}
                  itemStyle={{ color: CHART.tooltipText }}
                  labelStyle={{ color: CHART.axis }}
                  formatter={(value: number, name: string) => [
                    name === 'score' ? value.toFixed(1) : `${value}%`,
                    name === 'score' ? 'Form score' : 'Completion',
                  ]}
                />
                {/*
                  The two lines are told apart by DASH PATTERN as well as by
                  colour, and the caption below names which is which. A patient
                  who cannot separate teal from indigo can still read the chart.

                  Recharts draws a line by revealing it left to right, which is
                  the direction the data runs - recovery arriving over time.
                  That is worth keeping, so it is switched off only for readers
                  who asked for less movement.
                */}
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke={CHART.score}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: CHART.score, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                  animationEasing="ease-out"
                />
                <Line
                  type="monotone"
                  dataKey="completion"
                  stroke={CHART.completion}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={!reducedMotion}
                  animationDuration={900}
                  animationBegin={160}
                  animationEasing="ease-out"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-ink-500">
            Solid line: form score. Dashed line: percentage of the prescribed
            repetitions completed.
          </p>
        </div>
      </Card>
      </Reveal>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Reveal index={3}>
          <Card reveal={false}>
            <CardHeader title="By exercise" />
            <div className="divide-y divide-ink-100">
              {data.byExercise.map((exercise) => (
                <div
                  key={exercise.slug}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">
                      {exercise.name}
                    </p>
                    <p className="type-measure text-xs text-ink-500">
                      {exercise.sessions} session
                      {exercise.sessions === 1 ? '' : 's'} ·{' '}
                      {exercise.correctReps}/{exercise.totalReps} good reps
                    </p>
                  </div>
                  <span className="type-measure shrink-0 text-sm font-semibold text-ink-700">
                    {exercise.averageScore?.toFixed(1) ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </Reveal>

        <Reveal index={4}>
          <Card reveal={false}>
            <CardHeader
              title="Recurring issues"
              description="Most frequently detected across all sessions"
            />
            <div className="p-5">
              {data.recurringIssues.length === 0 ? (
                <p className="text-sm text-ink-600">
                  No recurring issues detected.
                </p>
              ) : (
                /*
                 * Ranked, and shown against the most common one rather than
                 * against a hundred. What a patient can act on is which fault
                 * dominates, and a bar drawn against an arbitrary ceiling would
                 * flatten exactly that difference away.
                 */
                <ul className="space-y-3">
                  {data.recurringIssues.map((issue) => {
                    const worst = Math.max(
                      ...data.recurringIssues.map((row) => row.occurrences),
                      1,
                    );
                    return (
                      <li key={issue.code}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm capitalize text-ink-800">
                            {issue.code.toLowerCase().replace(/_/g, ' ')}
                          </span>
                          <span className="type-measure text-sm text-ink-500">
                            {issue.occurrences}
                          </span>
                        </div>
                        <div
                          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100"
                          aria-hidden="true"
                        >
                          <div
                            className="animate-meter-grow h-full origin-left rounded-full bg-caution-500"
                            style={{
                              width: `${(issue.occurrences / worst) * 100}%`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </Reveal>
      </div>

      <p className="mt-6 max-w-prose text-xs leading-relaxed text-ink-500">
        {data.methodology}
      </p>
    </div>
  );
}
