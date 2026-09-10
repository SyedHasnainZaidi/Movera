import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from '../src/components/PasswordInput';
import { passwordSchema } from '../src/lib/password';

/**
 * Password field behaviour.
 *
 * The visibility toggle previously "appeared inconsistently" because there was
 * no toggle in this application at all - what users saw was Edge's native
 * `::-ms-reveal`, which other browsers do not render. These tests pin the
 * replacement's contract so it cannot regress to something browser-dependent.
 */
describe('PasswordInput - toggle visibility', () => {
  const toggle = () => screen.queryByRole('button', { name: /password/i });

  it('shows no toggle while the field is empty', () => {
    render(<PasswordInput aria-label="Password" />);
    expect(toggle()).toBeNull();
  });

  it('shows the toggle as soon as the first character is typed', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);

    await user.type(screen.getByLabelText('Password'), 'a');

    expect(toggle()).toBeTruthy();
    expect(toggle()).toHaveAccessibleName('Show password');
  });

  it('keeps the toggle visible while text remains', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const field = screen.getByLabelText('Password');

    await user.type(field, 'Secret@1');
    expect(toggle()).toBeTruthy();

    await user.type(field, '23');
    expect(toggle()).toBeTruthy();
  });

  it('hides the toggle again when the field is cleared', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const field = screen.getByLabelText('Password');

    await user.type(field, 'Secret@1');
    expect(toggle()).toBeTruthy();

    await user.clear(field);
    expect(toggle()).toBeNull();
  });

  it('switches the input between password and text', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const field = screen.getByLabelText('Password');

    await user.type(field, 'Secret@1');
    expect(field).toHaveAttribute('type', 'password');

    await user.click(toggle()!);
    expect(field).toHaveAttribute('type', 'text');
    expect(toggle()).toHaveAccessibleName('Hide password');

    await user.click(toggle()!);
    expect(field).toHaveAttribute('type', 'password');
  });

  it('re-masks when the field is emptied, so the next entry starts hidden', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const field = screen.getByLabelText('Password');

    await user.type(field, 'Secret@1');
    await user.click(toggle()!);
    expect(field).toHaveAttribute('type', 'text');

    await user.clear(field);
    await user.type(field, 'Another@2');

    // Without the reset, the second password would be displayed in plain text.
    expect(field).toHaveAttribute('type', 'password');
    expect(toggle()).toHaveAccessibleName('Show password');
  });

  it('never submits the surrounding form', async () => {
    const user = userEvent.setup();
    let submitted = false;

    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <PasswordInput aria-label="Password" />
      </form>,
    );

    await user.type(screen.getByLabelText('Password'), 'Secret@1');
    await user.click(toggle()!);

    expect(submitted).toBe(false);
  });
});

/**
 * Mirrors apps/backend/src/auth/dto/auth.dto.ts. These are the examples given
 * in the specification, kept here so a change to one rule fails a test rather
 * than silently diverging from the server.
 */
describe('Password policy', () => {
  const accepts = (value: string) => passwordSchema.safeParse(value).success;

  it('rejects the specification example without a special character', () => {
    expect(accepts('Password123')).toBe(false);
  });

  it('accepts the specification example with one', () => {
    expect(accepts('Password@1')).toBe(true);
  });

  it('rejects anything shorter than 7 characters', () => {
    expect(accepts('Ab@1cd')).toBe(false);
  });

  it('accepts exactly 7 characters with a special character', () => {
    expect(accepts('Abc@123')).toBe(true);
  });

  it('treats any non-alphanumeric character as special', () => {
    for (const value of ['abcdef!', 'abcdef ', 'abcdef-', 'abcdef£']) {
      expect(accepts(value)).toBe(true);
    }
  });

  it('rejects a long password made only of letters and digits', () => {
    expect(accepts('abcdefghijklmnop1234567890')).toBe(false);
  });

  it('reports the same message for both failure modes', () => {
    const short = passwordSchema.safeParse('a@b');
    const plain = passwordSchema.safeParse('abcdefghij');
    expect(short.success).toBe(false);
    expect(plain.success).toBe(false);
    if (!short.success && !plain.success) {
      expect(short.error.issues[0].message).toContain('special character');
      expect(plain.error.issues[0].message).toContain('special character');
    }
  });
});
