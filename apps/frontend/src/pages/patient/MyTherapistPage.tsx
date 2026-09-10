import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
} from '../../components/ui';

interface PatientProfile {
  id: string;
  firstName: string;
  lastName: string;
  conditionSummary: string | null;
  therapists: {
    therapistProfileId: string;
    name: string;
    specialization: string | null;
    isPrimary: boolean;
  }[];
  activePlan: {
    id: string;
    title: string;
    goals: string | null;
    startDate: string;
    endDate: string | null;
    therapistName: string;
  } | null;
}

interface InviteResponse {
  code: string;
  expiresAt: string;
  expiresInMinutes: number;
  instructions: string;
}

/**
 * Patient-initiated linking.
 *
 * The patient generates a code and gives it to their physiotherapist. This is
 * deliberately the opposite of the superseded prototype, where a therapist
 * could claim any patient by typing an email address - which meant anyone who
 * knew an email could attach themselves to that person's clinical record.
 */
export function MyTherapistPage() {
  const queryClient = useQueryClient();
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient', 'profile'],
    queryFn: async () => {
      const { data } = await api.get<PatientProfile>('/patients/me');
      return data;
    },
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<InviteResponse>(
        '/patients/me/link-invites',
      );
      return data;
    },
    onSuccess: (data) => {
      setInvite(data);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: ['patient', 'profile'] });
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <LoadingBlock label="Loading your details" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorState message={getErrorMessage(error)} onRetry={() => refetch()} />
      </div>
    );
  }

  const copyCode = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
    } catch {
      // Clipboard access can be blocked; the code is visible on screen anyway.
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Reveal>
        <PageHeader
          title="My physiotherapist"
          description="Share an invite code to let a physiotherapist see your sessions"
        />
      </Reveal>

      <Card className="mt-6">
        <CardHeader title="Linked physiotherapists" />
        <div className="divide-y divide-ink-100">
          {data.therapists.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No physiotherapist linked yet"
                description="Generate a code below and give it to your physiotherapist. Only someone holding a valid code can access your records."
              />
            </div>
          ) : (
            data.therapists.map((therapist) => (
              <div key={therapist.therapistProfileId} className="px-5 py-4">
                <p className="text-sm font-medium text-ink-900">
                  {therapist.name}
                  {therapist.isPrimary && (
                    <span className="ml-2 text-xs font-normal text-ink-500">
                      (primary)
                    </span>
                  )}
                </p>
                {therapist.specialization && (
                  <p className="text-sm text-ink-500">
                    {therapist.specialization}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </Card>

      {data.activePlan && (
        <Card className="mt-6">
          <CardHeader
            title="Your rehabilitation plan"
            description={data.activePlan.title}
          />
          <div className="space-y-2 p-5">
            {data.activePlan.goals && (
              <p className="text-sm leading-relaxed text-ink-700">
                {data.activePlan.goals}
              </p>
            )}
            <p className="text-xs text-ink-500">
              Started{' '}
              {new Date(data.activePlan.startDate).toLocaleDateString()}
              {data.activePlan.endDate &&
                ` · ends ${new Date(data.activePlan.endDate).toLocaleDateString()}`}
              {' · '}
              {data.activePlan.therapistName}
            </p>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Link a physiotherapist"
          description="Share a one-time code so they can access your programme"
        />
        <div className="p-5">
          {!invite ? (
            <>
              <p className="text-sm leading-relaxed text-ink-700">
                Generating a code lets one physiotherapist connect to your
                account. The code can be used once and expires shortly after it
                is created.
              </p>
              <Button
                className="mt-4"
                onClick={() => createInvite.mutate()}
                loading={createInvite.isPending}
              >
                Generate code
              </Button>
              {createInvite.isError && (
                <p className="mt-3 text-sm text-problem-700" role="alert">
                  {getErrorMessage(createInvite.error)}
                </p>
              )}
            </>
          ) : (
            <div>
              <p className="text-sm text-ink-700">{invite.instructions}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <code className="rounded-lg border border-brand-500/30 bg-brand-50 px-5 py-3 font-mono text-2xl font-semibold tracking-[0.2em] text-brand-800">
                  {invite.code}
                </code>
                <Button variant="secondary" onClick={copyCode}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="mt-3 text-xs text-ink-500">
                Expires at {new Date(invite.expiresAt).toLocaleTimeString()} (
                {invite.expiresInMinutes} minutes). Generating a new code
                cancels this one.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={() => createInvite.mutate()}
                loading={createInvite.isPending}
              >
                Generate a new code
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
