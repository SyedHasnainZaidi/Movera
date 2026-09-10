import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, getErrorMessage } from '../../api/client';
import { ProgressRing, RangeBar } from '../../components/instruments';
import { Reveal } from '../../components/motion';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  LoadingBlock,
  PageHeader,
  PrototypeDisclaimer,
  StatStrip,
} from '../../components/ui';
import { formatSeconds } from '../../lib/prescription';
import { useAuthStore } from '../../stores/authStore';
import type { SessionReport } from '../../types/api';

/**
 * Session report.
 *
 * Every figure shown here was computed by the backend from stored records -
 * repetitions for a countable exercise, the posture snapshot for a held one.
 * The page renders; it never calculates. That is the whole reason the numbers
 * can be trusted, and it is the direct fix for the superseded prototype, whose
 * session screen posted a hard-coded accuracy of 80.
 *
 * A therapist viewing the same report sees the additional technical detail;
 * the patient sees the plain-language version.
 */
export function SessionReportPage() {
  const { sessionId = '' } = useParams();
  const role = useAuthStore((state) => state.user?.role);
  const isTherapist = role === 'THERAPIST';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['session', sessionId, 'report'],
    queryFn: async () => {
      const { data } = await api.get<SessionReport>(
        `/sessions/${sessionId}/report`,
      );
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <LoadingBlock label="Loading your report" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <ErrorState message={getErrorMessage(error)} onRetry={() => refetch()} />
      </div>
    );
  }

  const { results, prescription } = data;
  const minutes = Math.floor(data.durationSec / 60);
  const seconds = data.durationSec % 60;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Reveal>
        <PageHeader
          title={data.exercise.name}
          description={`${new Date(data.startedAt).toLocaleString()} · ${minutes}m ${seconds}s${
            isTherapist ? ` · ${data.patient.name}` : ''
          }`}
          action={
            <Link to={isTherapist ? '/therapist/patients' : '/patient'}>
              <Button variant="secondary" size="sm">
                Back
              </Button>
            </Link>
          }
        />
      </Reveal>

      {/*
        The verdict, given the room it deserves.

        A patient opening this page has one question, and it is not how many
        repetitions they logged - it is whether they did it well. The score gets
        the dial and the plain-language summary sits beside it; the detailed
        figures follow underneath for anyone who wants them.
      */}
      <Reveal index={1}>
        <div className="mt-6 flex flex-wrap items-center gap-6 rounded-card border border-brand-500/25 bg-brand-50 px-6 py-5">
          <div className="relative inline-grid shrink-0 place-items-center text-brand-500">
            <ProgressRing
              value={results.performanceScore}
              max={100}
              size={104}
              thickness={8}
              ariaLabel={
                data.goalType === 'HOLD' ? 'Alignment score' : 'Form score'
              }
            />
            <div className="absolute inset-0 grid place-items-center">
              <p className="type-display type-measure text-[24px] leading-none text-brand-900">
                {results.performanceScore.toFixed(0)}
              </p>
            </div>
          </div>

          <p className="min-w-[16rem] flex-1 text-[15px] leading-relaxed text-brand-900">
            {data.summary}
          </p>
        </div>
      </Reveal>

      {/*
        A held-position session performed no repetitions, so showing a rep
        counter for one would report every posture session as 0 out of 0. The
        two goal types get different statistics because they measured
        different things.
      */}
      <Reveal index={2}>
        <StatStrip
          reveal={false}
          className="mt-6"
          items={
            data.goalType === 'HOLD' && data.hold
              ? [
                  {
                    label: 'Time held',
                    value: formatSeconds(data.hold.heldSec),
                    hint: `${results.completionRatio}% of the prescription`,
                    meter: results.completionRatio / 100,
                    tone: 'brand',
                  },
                  {
                    label: 'Longest hold',
                    value: formatSeconds(data.hold.bestStreakSec),
                    hint: 'Best unbroken stretch',
                  },
                  {
                    label: 'Alignment score',
                    value: results.performanceScore.toFixed(1),
                    hint: 'Mean of per-frame scores',
                  },
                  {
                    label: 'Prescribed',
                    value: formatSeconds(data.hold.targetSec),
                    hint: 'Correctly aligned, in total',
                  },
                ]
              : [
                  {
                    label: 'Repetitions',
                    value: `${results.totalReps} / ${prescription.targetTotalReps}`,
                    hint: `${results.completionRatio}% of the prescription`,
                    meter: results.completionRatio / 100,
                    tone: 'brand',
                  },
                  {
                    label: 'Good form',
                    value: results.correctReps,
                    hint: `${results.incorrectReps} needed attention`,
                    meter:
                      results.totalReps > 0
                        ? results.correctReps / results.totalReps
                        : undefined,
                    tone: 'good',
                  },
                  {
                    label: 'Form score',
                    value: results.performanceScore.toFixed(1),
                    hint: 'Mean of per-repetition scores',
                  },
                  {
                    label: 'Prescribed',
                    value: `${prescription.targetSets} × ${prescription.repsPerSet}`,
                    hint: 'Sets × repetitions',
                  },
                ]
          }
        />
      </Reveal>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Reveal index={3}>
        <Card reveal={false}>
          <CardHeader
            title="Points to work on"
            description="Detected across this session"
          />
          <div className="p-5">
            {data.commonErrors.length === 0 ? (
              <p className="text-sm text-ink-600">
                No recurring form issues were detected. Well done.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.commonErrors.map((issue) => (
                  <li
                    key={issue.code}
                    className="flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium capitalize text-ink-900">
                        {issue.code.toLowerCase().replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-ink-500">
                        Seen {issue.occurrences} time
                        {issue.occurrences === 1 ? '' : 's'}
                      </p>
                    </div>
                    <Badge
                      tone={
                        issue.severity === 'CRITICAL' ? 'problem' : 'caution'
                      }
                    >
                      {issue.severity.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        </Reveal>

        <Reveal index={4}>
        <Card reveal={false}>
          <CardHeader
            title="Range of motion"
            description="How far each joint travelled during this session"
          />
          <div className="p-5">
            {Object.keys(data.angleStats).length === 0 ? (
              <p className="text-sm text-ink-600">
                No angle statistics were recorded.
              </p>
            ) : (
              <div className="space-y-5">
                {Object.entries(data.angleStats).map(([name, stat]) => (
                  <RangeBar
                    key={name}
                    label={name.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    min={stat.min}
                    max={stat.max}
                    mean={stat.mean}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
        </Reveal>
      </div>

      {isTherapist && (
        <Card className="mt-6">
          <CardHeader
            title="Tracking quality"
            description="Technical detail for clinical review"
          />
          <div className="p-5">
            <p className="text-sm text-ink-700">
              Mean landmark visibility:{' '}
              <span className="font-medium tabular-nums">
                {(data.tracking.avgConfidence * 100).toFixed(1)}%
              </span>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-500">
              {data.tracking.note}
            </p>
          </div>
        </Card>
      )}

      <div className="mt-6 rounded-card border border-ink-200 bg-surface px-5 py-4">
        <PrototypeDisclaimer />
      </div>
    </div>
  );
}
