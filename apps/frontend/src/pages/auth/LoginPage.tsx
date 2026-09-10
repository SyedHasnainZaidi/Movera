import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, getErrorCode, getErrorMessage } from '../../api/client';
import { PasswordInput } from '../../components/PasswordInput';
import { Rise } from '../../components/motion';
import { Button, Field, inputClass } from '../../components/ui';
import { useAuthStore } from '../../stores/authStore';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

/** Seeded by `prisma:seed`. Kept in one place so the labels cannot drift. */
const DEV_ACCOUNTS = [
  { email: 'therapist@example.com', role: 'Physiotherapist' },
  { email: 'patient1@example.com', role: 'Patient' },
  { email: 'patient2@example.com', role: 'Patient' },
] as const;

const DEV_PASSWORD = 'DevPassword123!';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [formError, setFormError] = useState<string | null>(null);
  /** Set when the backend refuses the login specifically for verification. */
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  /** Which seeded account is mid-flight, so only its own control shows a spinner. */
  const [signingInAs, setSigningInAs] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const signIn = async (email: string, password: string) => {
    setFormError(null);
    setUnverifiedEmail(null);
    try {
      const user = await login(email, password);
      navigate(user.role === 'THERAPIST' ? '/therapist' : '/patient', {
        replace: true,
      });
    } catch (error) {
      setFormError(getErrorMessage(error));
      // Offer the fix rather than only naming the problem. The code is only
      // returned once the password has already been accepted, so showing a
      // resend control here does not reveal that an address is registered.
      if (getErrorCode(error) === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(email);
      }
    }
  };

  const onSubmit = (values: FormValues) => signIn(values.email, values.password);

  /**
   * One tap to sign in as a seeded account.
   *
   * The credentials were already printed on this screen in full, so nothing is
   * revealed that was not: what changes is that demonstrating the two roles
   * side by side no longer means retyping an address and a password with a
   * capital, a digit and a symbol in front of an audience.
   *
   * The form is filled as well as submitted, so if the request fails the
   * fields hold what was tried.
   */
  const signInAsSeeded = async (email: string) => {
    setValue('email', email);
    setValue('password', DEV_PASSWORD);
    setSigningInAs(email);
    try {
      await signIn(email, DEV_PASSWORD);
    } finally {
      setSigningInAs(null);
    }
  };

  return (
    <div>
      <Rise>
        <h1 className="type-display text-[26px] leading-tight text-ink-900">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Access your rehabilitation programme.
        </p>
      </Rise>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 space-y-4"
        noValidate
      >
        <Rise index={1}>
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={inputClass}
              {...register('email')}
            />
          </Field>
        </Rise>

        <Rise index={2}>
          <Field
            label="Password"
            htmlFor="password"
            error={errors.password?.message}
          >
            <PasswordInput
              id="password"
              autoComplete="current-password"
              {...register('password')}
            />
          </Field>

          <div className="mt-2 flex justify-end">
            <Link
              to="/forgot-password"
              className="link-underline text-sm font-medium text-brand-700"
            >
              Forgot password?
            </Link>
          </div>
        </Rise>

        {formError && (
          <p
            role="alert"
            className="animate-cue-in flex items-start gap-2.5 rounded-panel border border-problem-500/25 bg-problem-50 px-3.5 py-2.5 text-sm font-medium text-problem-700"
          >
            <AlertMark />
            <span>{formError}</span>
          </p>
        )}

        {unverifiedEmail && <ResendVerification email={unverifiedEmail} />}

        <Rise index={3}>
          <Button
            type="submit"
            size="lg"
            loading={isSubmitting && signingInAs === null}
            className="w-full"
          >
            Sign in
          </Button>
        </Rise>
      </form>

      <Rise index={4}>
        <p className="mt-6 text-sm text-ink-600">
          No account?{' '}
          <Link
            to="/register"
            className="link-underline font-medium text-brand-700"
          >
            Create one
          </Link>
        </p>
      </Rise>

      {/*
        Seed accounts for marking and demonstration. Set apart with a dashed
        border rather than a filled panel so it reads as scaffolding attached
        to the page, not as part of the sign-in form.
      */}
      <Rise index={5}>
        <div className="mt-8 rounded-panel border border-dashed border-ink-300 p-4">
          <p className="text-xs font-semibold text-ink-600">
            Development accounts
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Password <code className="font-mono">{DEV_PASSWORD}</code> — or sign
            in with one tap.
          </p>

          <ul className="mt-3 space-y-1.5">
            {DEV_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => void signInAsSeeded(account.email)}
                  disabled={signingInAs !== null}
                  className="row-interactive flex w-full items-center gap-2 rounded-readout px-2 py-1.5 text-left disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-700">
                    {account.email}
                  </span>
                  <span className="shrink-0 text-xs text-ink-500">
                    {account.role}
                  </span>
                  {signingInAs === account.email ? (
                    <span
                      className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand-600 border-t-transparent"
                      aria-hidden="true"
                    />
                  ) : (
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
                      className="row-arrow shrink-0 text-ink-500"
                    >
                      <path d="M6 3.5 L 10.5 8 L 6 12.5" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Rise>
    </div>
  );
}

function AlertMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-px shrink-0"
    >
      <circle cx="10" cy="10" r="8.2" strokeWidth={1.6} opacity={0.5} />
      <path d="M10 5.6 v 5 M10 13.6 v 0.6" />
    </svg>
  );
}

function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const resend = async () => {
    setState('sending');
    try {
      const { data } = await api.post<{ message: string }>(
        '/auth/resend-verification',
        { email },
      );
      setMessage(data.message);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setState('done');
    }
  };

  return (
    <div className="animate-cue-in rounded-panel border border-caution-500/30 bg-caution-50 px-3.5 py-3">
      <p className="text-sm text-caution-700">
        Your email address has not been confirmed yet.
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2"
        loading={state === 'sending'}
        disabled={state === 'done'}
        onClick={resend}
      >
        {state === 'done'
          ? 'Verification email sent'
          : 'Resend verification email'}
      </Button>
      {message && (
        <p role="status" className="mt-2 text-xs text-ink-600">
          {message}
        </p>
      )}
    </div>
  );
}
