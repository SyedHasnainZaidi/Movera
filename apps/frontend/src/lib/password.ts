import { z } from 'zod';

/**
 * Password policy, mirroring apps/backend/src/auth/dto/auth.dto.ts.
 *
 * This copy exists for immediate feedback while typing. It is NOT the
 * enforcement point - the backend validates every password independently, and
 * a client that skipped this file entirely would still be rejected. Kept in
 * one module so the three screens that accept a password (register, reset,
 * and any future change-password form) cannot drift apart from each other.
 *
 * "Special character" is anything that is not a letter or a digit, rather than
 * an allow-list of punctuation: an allow-list quietly rejects good passwords
 * containing characters nobody thought to include.
 */
export const PASSWORD_MIN_LENGTH = 7;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_SPECIAL_CHARACTER = /[^A-Za-z0-9]/;

export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 7 characters and include at least one special character.';

export const PASSWORD_HINT =
  'At least 7 characters, including one special character (for example ! @ # $).';

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, PASSWORD_RULE_MESSAGE)
  .max(PASSWORD_MAX_LENGTH, 'That password is too long.')
  .regex(PASSWORD_SPECIAL_CHARACTER, PASSWORD_RULE_MESSAGE);
