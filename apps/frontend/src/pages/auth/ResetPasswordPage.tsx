import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api, getErrorMessage } from '../../api/client';
import { PasswordInput } from '../../components/PasswordInput';
import { Button, Field } from '../../components/ui';
import { passwordSchema, PASSWORD_HINT } from '../../lib/password';

const schema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

/** Landing page for the link in the password reset email. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();

  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      await api.post('/auth/reset-password', {
        token,
        newPassword: values.newPassword,
      });
      setDone(true);
      // Straight to sign-in. Every session was revoked by the reset, so there
      // is no state to return to - the user must authenticate again.
      setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  };

  if (!token) {
    return (
      <div>
        <h1 className="type-display text-[26px] leading-tight text-ink-900">
          No reset token
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          Open the link from your password reset email. It carries the token
          needed to set a new password.
        </p>
        <Link to="/forgot-password" className="mt-6 block">
          <Button size="lg" className="w-full">
            Request a new link
          </Button>
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div role="status" aria-live="polite">
        <h1 className="type-display text-[26px] leading-tight text-ink-900">
          Password changed
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          Your password has been updated and you have been signed out
          everywhere. Taking you to the sign-in page.
        </p>
        <Link to="/login" className="mt-6 block">
          <Button size="lg" className="w-full">
            Sign in now
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="type-display text-[26px] leading-tight text-ink-900">Choose a new password</h1>
      <p className="mt-1 text-sm text-ink-500">
        Your existing sessions will be signed out.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 space-y-4"
        noValidate
      >
        <Field
          label="New password"
          htmlFor="newPassword"
          hint={PASSWORD_HINT}
          error={errors.newPassword?.message}
        >
          <PasswordInput
            id="newPassword"
            autoComplete="new-password"
            {...register('newPassword')}
          />
        </Field>

        <Field
          label="Confirm new password"
          htmlFor="confirmPassword"
          error={errors.confirmPassword?.message}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            {...register('confirmPassword')}
          />
        </Field>

        {formError && (
          <p
            role="alert"
            className="rounded-lg bg-problem-50 px-3 py-2 text-sm font-medium text-problem-700"
          >
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Set new password
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-600">
        Link expired?{' '}
        <Link
          to="/forgot-password"
          className="font-medium text-brand-700 underline"
        >
          Request a new one
        </Link>
      </p>
    </div>
  );
}
