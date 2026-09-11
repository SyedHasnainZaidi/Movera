import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  PrototypeDisclaimer,
  RowArrow,
} from '../../components/ui';
import { describeAchievement } from '../../lib/prescription';
import type {
  AppNotification,
  Page,
  SessionSummary,
} from '../../types/api';

/** Patient session history. */
export function SessionHistoryPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient', 'sessions'],
    queryFn: async () => {
      const { data } = await api.get<Page<SessionSummary>>(
        '/patients/me/sessions?limit=50',
      );
      return data;
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Reveal>
        <PageHeader
          title="Session history"
          description="Every completed session, newest first"
        />
      </Reveal>

      <div className="mt-6">
        {isLoading ? (
          <LoadingBlock label="Loading sessions" />
        ) : isError || !data ? (
          <ErrorState
            message={getErrorMessage(error)}
            onRetry={() => refetch()}
          />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="Completed exercise sessions will be listed here with their reports."
          />
        ) : (
          <Card>
            <CardHeader
              title="Completed sessions"
              description={`${data.meta.total} in total`}
            />
            <div className="divide-y divide-ink-100">
              {data.data.map((session) => (
                <Link
                  key={session.id}
                  to={`/patient/sessions/${session.id}/report`}
                  className="row-interactive flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink-900">
                        {session.exercise.name}
                      </p>
                      {session.status === 'CANCELLED' && (
                        <Badge tone="neutral">Cancelled</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {new Date(session.startedAt).toLocaleString()} Â·{' '}
                      {describeAchievement(session)}
                      {/* correctReps is always 0 on a held session - it counted
                          no repetitions - so showing it would read as a fail. */}
                      {session.goalType !== 'HOLD' &&
                        ` Â· ${session.correctReps} good form`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="type-measure text-lg font-semibold text-ink-700">
                      {session.performanceScore?.toFixed(0) ?? 'â€”'}
                    </span>
                    <RowArrow />
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Shared by both roles. */
export function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data } = await api.get<
        Page<AppNotification> & { unreadCount: number }
      >('/notifications?limit=50');
      return data;
    },
  });

  const markAll = useMutation({
    mutationFn: async () => {
      await api.patch('/notifications/read-all');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markOne = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/${id}/read`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="type-display text-[26px] leading-tight text-ink-900">Notifications</h1>
        {(data?.unreadCount ?? 0) > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div className="mt-6">
        {isLoading ? (
          <LoadingBlock label="Loading notifications" />
        ) : isError || !data ? (
          <ErrorState
            message={getErrorMessage(error)}
            onRetry={() => refetch()}
          />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="Nothing to read"
            description="Updates about your exercises, plan and feedback appear here."
          />
        ) : (
          <Card>
            <div className="divide-y divide-ink-100">
              {data.data.map((notification) => (
                <div
                  key={notification.id}
                  /*
                    An unread row is marked with a rule down its edge as well
                    as a tint. A half-strength wash of a pale colour is nearly
                    invisible under one theme and muddy under the other, and it
                    was the only thing distinguishing read from unread - the
                    solid edge holds up in both and does not depend on telling
                    two tints apart.
                  */
                  className={`px-5 py-4 ${
                    notification.read
                      ? ''
                      : 'border-l-2 border-brand-500 bg-brand-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">
                        {notification.title}
                        {!notification.read && (
                          <span className="ml-2">
                            <Badge tone="brand">New</Badge>
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-600">
                        {notification.message}
                      </p>
                      <p className="mt-1 text-xs text-ink-400">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!notification.read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markOne.mutate(notification.id)}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

interface LibraryExercise {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  targetBodyArea: string;
  recommendedView: string;
  defaultSets: number;
  defaultReps: number;
  isActive: boolean;
  analysisAvailable: boolean;
}

/** The system-managed exercise catalogue. */
export function ExerciseLibraryPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['exercises', 'all'],
    queryFn: async () => {
      const { data } = await api.get<LibraryExercise[]>(
        '/exercises?includeInactive=true',
      );
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <LoadingBlock label="Loading library" />
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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Reveal>
        <PageHeader
          title="Exercise library"
          description="System-managed. Pose-analysis rules are global, so they are not editable per therapist - configure sets, repetitions and instructions on each assignment instead."
        />
      </Reveal>

      <div className="mt-6 space-y-4">
        {data.map((exercise, index) => (
          <Card key={exercise.id} revealIndex={index} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-ink-900">
                    {exercise.name}
                  </h2>
                  <Badge tone={exercise.analysisAvailable ? 'good' : 'neutral'}>
                    {exercise.analysisAvailable
                      ? 'Analysis ready'
                      : 'Not analysable yet'}
                  </Badge>
                  <Badge tone="neutral">
                    {exercise.recommendedView.toLowerCase().replace('_', ' ')} view
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">
                  {exercise.description}
                </p>
                <p className="mt-2 text-xs text-ink-500">
                  {exercise.category} Â· {exercise.targetBodyArea} Â· default{' '}
                  {exercise.defaultSets} Ã— {exercise.defaultReps}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <PrototypeDisclaimer className="mt-8" />
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-3xl font-semibold text-ink-900">Page not found</h1>
      <p className="mt-2 text-sm text-ink-500">
        The page you are looking for does not exist.
      </p>
      <Link to="/" className="mt-6 inline-block">
        <Button>Back to overview</Button>
      </Link>
    </div>
  );
}
