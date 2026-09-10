import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { api, getErrorMessage } from '../../api/client';
import { PasswordInput } from '../../components/PasswordInput';
import { Button, Field, inputClass } from '../../components/ui';
import { passwordSchema, PASSWORD_HINT } from '../../lib/password';
import {
  useAuthStore,
  type RegistrationResult,
} from '../../stores/authStore';

/**
 * The role field offers PATIENT and THERAPIST only.
 *
 * This is a convenience, not the security control: the server independently
 * rejects any other value. Client-side validation that is not mirrored on the
 * server is how the superseded prototype allowed self-registration as admin.
 */
const schema = z
  .object({
    firstName: z.string().min(1, 'Enter your first name.').max(80),
    lastName: z.string().min(1, 'Enter your last name.').max(80),
    email: z.string().email('Enter a valid email address.'),
    password: passwordSchema,
    confirmPassword: z.string(),
    role: z.enum(['PATIENT', 'THERAPIST']),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const registerUser = useAuthStore((state) => state.register);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'PATIENT' },
  });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      const registration = await registerUser({
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
        role: values.role,
      });
      // No navigation: the account cannot sign in yet, so sending them into
      // the app would only produce a bounce back to the login screen.
      setResult(registration);
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  };

  if (result) {
    return <CheckYourEmail result={result} />;
  }

  return (
    <div>
      <h1 className="type-display text-[26px] leading-tight text-ink-900">
        Create your Movera account
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        Patients and physiotherapists both register here.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 space-y-4"
        noValidate
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-800">
            I am registering as
          </legend>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['PATIENT', 'Patient', 'Follow a prescribed programme'],
                ['THERAPIST', 'Physiotherapist', 'Manage and review patients'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className="flex cursor-pointer flex-col rounded-lg border border-ink-300 bg-surface px-3 py-2.5 text-sm has-checked:border-brand-500 has-checked:bg-brand-50"
              >
                <span className="flex items-center gap-2 font-medium text-ink-900">
                  <input
                    type="radio"
                    value={value}
                    className="accent-brand-600"
                    {...register('role')}
                  />
                  {label}
                </span>
                <span className="mt-0.5 pl-6 text-xs text-ink-500">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="First name"
            htmlFor="firstName"
            error={errors.firstName?.message}
          >
            <input
              id="firstName"
              autoComplete="given-name"
              className={inputClass}
              {...register('firstName')}
            />
          </Field>
          <Field
            label="Last name"
            htmlFor="lastName"
            error={errors.lastName?.message}
          >
            <input
              id="lastName"
              autoComplete="family-name"
              className={inputClass}
              {...register('lastName')}
            />
          </Field>
        </div>

        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={inputClass}
            {...register('email')}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          hint={PASSWORD_HINT}
          error={errors.password?.message}
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            {...register('password')}
          />
        </Field>

        <Field
          label="Confirm password"
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
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-600">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-brand-700 underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

/**
 * Shown after a successful signup.
 *
 * Includes a resend control because "the email never arrived" is the single
 * most common failure of an email-verification flow, and leaving the user with
 * no recourse but to register again would create a duplicate-email dead end.
 */
function CheckYourEmail({ result }: { result: RegistrationResult }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState<string | null>(null);

  const resend = async () => {
    setStatus('sending');
    setMessage(null);
    try {
      const { data } = await api.post<{ message: string }>(
        '/auth/resend-verification',
        { email: result.email },
      );
      setStatus('sent');
      setMessage(data.message);
    } catch (error) {
      setStatus('error');
      setMessage(getErrorMessage(error));
    }
  };

  return (
    <div>
      <h1 className="type-display text-[26px] leading-tight text-ink-900">Check your email</h1>

      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        {result.message}
      </p>

      <p className="mt-4 rounded-lg border border-ink-200 bg-sunken px-3 py-2 text-sm text-ink-700">
        We sent a verification link to{' '}
        <span className="font-medium text-ink-900">{result.email}</span>
      </p>

      {!result.verificationEmailSent && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-caution-50 px-3 py-2 text-sm font-medium text-caution-700"
        >
          The message could not be sent just now. Your account exists - use
          "Resend" below, or ask an administrator to check the mail settings.
        </p>
      )}

      <div className="mt-6 space-y-3">
        <Button
          variant="secondary"
          className="w-full"
          loading={status === 'sending'}
          onClick={resend}
        >
          Resend verification email
        </Button>

        <Link to="/login" className="block">
          <Button size="lg" className="w-full">
            Go to sign in
          </Button>
        </Link>
      </div>

      {message && (
        <p
          role="status"
          className={`mt-4 text-sm ${
            status === 'error' ? 'text-problem-700' : 'text-ink-600'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
