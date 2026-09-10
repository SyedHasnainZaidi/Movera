import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, getErrorMessage } from '../../api/client';
import { Button } from '../../components/ui';

type State = 'verifying' | 'success' | 'failed' | 'no-token';

/**
 * Landing page for the link in the verification email.
 *
 * The token arrives as `?token=...` and is exchanged for a confirmation as
 * soon as the page opens - the user has already expressed intent by clicking
 * the link, so making them press a second button would be pure friction.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [state, setState] = useState<State>(token ? 'verifying' : 'no-token');
  const [message, setMessage] = useState<string>('');

  /**
   * React 18+ runs effects twice in development StrictMode. The token is
   * single-use, so a second call would consume it and report failure on a
   * verification that actually succeeded. This guard makes the exchange happen
   * exactly once per mount.
   */
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        const { data } = await api.post<{ message: string }>(
          '/auth/verify-email',
          { token },
        );
        setMessage(data.message);
        setState('success');
      } catch (error) {
        setMessage(getErrorMessage(error));
        setState('failed');
      }
    })();
  }, [token]);

  if (state === 'verifying') {
    return (
      <div role="status" aria-live="polite">
        <h1 className="type-display text-[26px] leading-tight text-ink-900">
          Verifying your email
        </h1>
        <p className="mt-2 text-sm text-ink-500">One moment.</p>
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-ink-200">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-600" />
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div>
        <StatusIcon tone="good" />
        <h1 className="type-display mt-4 text-[26px] leading-tight text-ink-900">
          Email verified
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">{message}</p>
        <Link to="/login" className="mt-6 block">
          <Button size="lg" className="w-full">
            Continue to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <StatusIcon tone="problem" />
      <h1 className="type-display mt-4 text-[26px] leading-tight text-ink-900">
        {state === 'no-token'
          ? 'No verification token'
          : 'This link did not work'}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">
        {state === 'no-token'
          ? 'Open the link from your verification email, which carries the token needed to confirm your address.'
          : message}
      </p>
      <p className="mt-4 text-sm text-ink-600">
        You can request a fresh link from the sign-in page after entering your
        password.
      </p>
      <Link to="/login" className="mt-6 block">
        <Button size="lg" variant="secondary" className="w-full">
          Back to sign in
        </Button>
      </Link>
    </div>
  );
}

function StatusIcon({ tone }: { tone: 'good' | 'problem' }) {
  const styles =
    tone === 'good'
      ? 'bg-good-50 text-good-700'
      : 'bg-problem-50 text-problem-700';

  return (
    <span
      aria-hidden="true"
      className={`grid h-12 w-12 place-items-center rounded-full ${styles}`}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {tone === 'good' ? (
          <path d="m5 13 4 4L19 7" />
        ) : (
          <>
            <path d="M12 8v5" />
            <path d="M12 16.5v.01" />
          </>
        )}
      </svg>
    </span>
  );
}
