import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
  Field,
  LoadingBlock,
  PageHeader,
  RowArrow,
  inputClass,
} from '../../components/ui';
import type { CaseloadPatient, Page } from '../../types/api';

export function PatientsPage() {
  const queryClient = useQueryClient();
  const [inviteCode, setInviteCode] = useState('');
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['therapist', 'patients'],
    queryFn: async () => {
      const { data } = await api.get<Page<CaseloadPatient>>(
        '/therapists/me/patients?limit=50',
      );
      return data;
    },
  });

  const link = useMutation({
    mutationFn: async (code: string) => {
      const { data } = await api.post<{ patientName: string }>(
        '/therapists/me/patients/link',
        { inviteCode: code.trim().toUpperCase() },
      );
      return data;
    },
    onSuccess: (result) => {
      setLinkMessage(`${result.patientName} is now linked to your account.`);
      setInviteCode('');
      void queryClient.invalidateQueries({ queryKey: ['therapist'] });
    },
    onError: () => setLinkMessage(null),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Reveal>
        <PageHeader
          title="Patients"
          description="You can only see patients who have shared an invite code with you."
        />
      </Reveal>

      <Card className="mt-6">
        <CardHeader
          title="Link a patient"
          description="Ask the patient to generate a code from their account"
        />
        <form
          className="flex flex-wrap items-end gap-3 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (inviteCode.trim()) link.mutate(inviteCode);
          }}
        >
          <div className="w-48">
            <Field label="Invite code" htmlFor="inviteCode">
              <input
                id="inviteCode"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="K7M2QX9B"
                maxLength={16}
                autoComplete="off"
                className={`${inputClass} font-mono uppercase tracking-widest`}
              />
            </Field>
          </div>
          <Button
            type="submit"
            loading={link.isPending}
            disabled={!inviteCode.trim()}
          >
            Link patient
          </Button>
        </form>

        {(linkMessage || link.isError) && (
          <div className="px-5 pb-5">
            {linkMessage && (
              <p
                role="status"
                className="rounded-lg bg-good-50 px-3 py-2 text-sm font-medium text-good-700"
              >
                {linkMessage}
              </p>
            )}
            {link.isError && (
              <p
                role="alert"
                className="rounded-lg bg-problem-50 px-3 py-2 text-sm font-medium text-problem-700"
              >
                {getErrorMessage(link.error)}
              </p>
            )}
          </div>
        )}
      </Card>

      <div className="mt-6">
        {isLoading ? (
          <LoadingBlock label="Loading patients" />
        ) : isError || !data ? (
          <ErrorState
            message={getErrorMessage(error)}
            onRetry={() => refetch()}
          />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No patients linked"
            description="Once a patient shares their invite code and you enter it above, they will appear here."
          />
        ) : (
          <Card>
            <CardHeader
              title="Your caseload"
              description={`${data.meta.total} patient${data.meta.total === 1 ? '' : 's'}`}
            />
            <div className="divide-y divide-ink-100">
              {data.data.map((patient) => (
                <Link
                  key={patient.patientProfileId}
                  to={`/therapist/patients/${patient.patientProfileId}`}
                  className="row-interactive flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink-900">
                        {patient.name}
                      </p>
                      {patient.activePlan ? (
                        <Badge tone="brand">{patient.activePlan.title}</Badge>
                      ) : (
                        <Badge tone="caution">No active plan</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-500">
                      {patient.conditionSummary ?? patient.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-sm">
                      <p className="type-measure font-medium text-ink-800">
                        {patient.totalSessions} session
                        {patient.totalSessions === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs text-ink-500">
                        {patient.lastSessionAt
                          ? `Last: ${new Date(patient.lastSessionAt).toLocaleDateString()}`
                          : 'No sessions yet'}
                      </p>
                    </div>
                    <RowArrow />
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>

      <ArchivedPatients />
    </div>
  );
}

/**
 * Patients whose link has been ended.
 *
 * They are listed so a discharged patient is not simply gone: the therapist
 * can see the relationship existed, when it ended, and how much history is
 * waiting if the patient returns.
 *
 * Deliberately NOT links. Ending the relationship ends access to the record,
 * so these rows show a name, a date and a count and nothing more - clicking
 * through would only produce a 403, and offering the route would suggest the
 * data is still theirs to read. It is not, until the patient shares a new
 * invite code.
 */
function ArchivedPatients() {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['therapist', 'patients', 'archived'],
    queryFn: async () => {
      const { data } = await api.get<Page<CaseloadPatient>>(
        '/therapists/me/patients?scope=archived&limit=50',
      );
      return data;
    },
  });

  const total = data?.meta.total ?? 0;
  if (isLoading || total === 0) return null;

  return (
    <Card className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="row-interactive flex w-full items-center gap-2 rounded-card px-5 py-4 text-left"
      >
        {/*
          The marker turns to point at what it opened, rather than being
          swapped for a different character. A rotation is continuous, so it is
          obvious which state it moved to even out of the corner of the eye.
        */}
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-ink-500 transition-transform duration-[220ms] ease-[cubic-bezier(0.16,0.84,0.44,1)] ${
            open ? 'rotate-90' : ''
          }`}
        >
          <path d="M6 3.5 L 10.5 8 L 6 12.5" />
        </svg>

        <span className="text-sm font-semibold text-ink-800">
          Archived patients ({total})
        </span>
        <span className="text-sm font-normal text-ink-500">
          history kept · re-link with a new invite code to restore access
        </span>
      </button>

      {open && (
        <div className="animate-cue-in divide-y divide-ink-100 border-t border-ink-200">
          {data?.data.map((patient) => (
            <div
              key={patient.patientProfileId}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-800">
                  {patient.name}
                </p>
                <p className="mt-0.5 truncate text-sm text-ink-500">
                  {patient.email}
                </p>
              </div>
              <div className="text-right text-sm">
                <p className="font-medium tabular-nums text-ink-700">
                  {patient.totalSessions} session
                  {patient.totalSessions === 1 ? '' : 's'} kept
                </p>
                <p className="text-xs text-ink-500">
                  {patient.archivedAt
                    ? `Archived ${new Date(patient.archivedAt).toLocaleDateString()}`
                    : 'Archived'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
