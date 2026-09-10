import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { api, getErrorMessage } from '../../api/client';
import { Button, Field, inputClass } from '../../components/ui';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      const { data } = await api.post<{ message: string }>(
        '/auth/forgot-password',
        { email: values.email },
      );
      // The backend answers identically whether or not the address exists, so
      // this screen must not imply that a message was definitely sent to a
      // real account - that would leak which addresses are registered.
      setConfirmation(data.message);
      setSent(true);
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  };

  if (sent) {
    return (
      <div>
        <h1 className="type-display text-[26px] leading-tight text-ink-900">Check your email</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-600">
          {confirmation}
        </p>
        <p className="mt-4 text-sm text-ink-500">
          The link expires shortly and can only be used once.
        </p>
        <Link to="/login" className="mt-6 block">
          <Button size="lg" className="w-full">
            Back to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="type-display text-[26px] leading-tight text-ink-900">Forgot password</h1>
      <p className="mt-1 text-sm text-ink-500">
        Enter your email address and we will send you a link to choose a new
        password.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 space-y-4"
        noValidate
      >
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={inputClass}
            {...register('email')}
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
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-600">
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-brand-700 underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
