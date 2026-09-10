# Movera update — branding, authentication, email, startup

Enhancement phase on the working platform. Nothing was redesigned: the patient
and therapist workflows, exercise assignment, pose/session pipeline, PostgreSQL
18 database, Prisma setup and therapist–patient linking all work exactly as
before.

## 1. What changed

### Branding (Part 1–2)

| Where | Before | After |
| --- | --- | --- |
| Browser tab | "Physio Rehab Platform" | **Movera** |
| Navbar | square "PR" tile, not clickable | circular **M** mark + wordmark, links to `/` |
| Sign-in / sign-up | no branding | M mark and "Movera" above the form |
| Footer | disclaimer only | "Movera · Rehabilitation monitoring" + disclaimer |
| API docs | "Physiotherapy Rehabilitation API" | **Movera API** |
| Emails | none existed | Movera header, monogram and footer on every message |

The mark is drawn in CSS rather than shipped as an image, so it stays sharp at
any size and adds nothing to load. `MoveraBrand` links to `/`, which the
existing router resolves to whichever dashboard the signed-in user belongs to —
so "home" is correct for both roles without a second route or a new page.

Deliberately **unchanged**, as instructed: database name, table and column
names, folder names, API routes, npm package names (`@physio/backend`,
`@physio/frontend`). Renaming any of those would be migration risk for no user
benefit.

### Email uniqueness (Part 3)

Already enforced — `User.email` carried `@unique`, and `AuthService.register`
already checked before inserting. Two things were added:

- the exact message you specified: *"This email is already registered. Please
  use a different email address."*
- test coverage proving one address cannot hold both a patient and a therapist
  account, and that `Foo@x` and `foo@x` are the same account.

### Email verification (Part 4)

```
signup → account created (unverified) → verification email
       → user clicks link → /verify-email → token exchanged
       → emailVerified = true → login permitted
```

`POST /auth/register` **no longer returns an access token**. It returns
`{ email, emailVerificationRequired, verificationEmailSent, message }`.
Returning a session would have walked straight past the rule that login
enforces. The signup screen now ends on a "Check your email" panel with a
resend button.

Login refuses an unverified account with `EMAIL_NOT_VERIFIED` and the message
*"Please verify your email before logging in."* — checked **after** the
password, so the distinct message cannot be used to discover which addresses are
registered.

### Password reset (Part 5)

```
login → Forgot password → email → /reset-password?token=…
      → new password → token destroyed → all sessions revoked → sign in
```

The reset revokes every existing refresh token. If the reset happened because
the account was compromised, leaving the attacker's session alive would defeat
the whole exercise.

### Token storage

Neither token is stored in readable form. Only a SHA-256 hash is written, and
lookups are by hash — the same design already used for refresh tokens and
invite codes. A leaked database row yields nothing usable, because the
plaintext only ever existed in the email.

| | Lifetime | Single use |
| --- | --- | --- |
| Verification | 24 h (`EMAIL_VERIFICATION_TTL_HOURS`) | yes, cleared on use |
| Password reset | 60 min (`PASSWORD_RESET_TTL_MINUTES`) | yes, cleared on use |

Both "forgot password" and "resend verification" answer identically whether or
not the address exists. On a health platform, confirming that someone has an
account is itself disclosure.

### Password policy (Part 6)

Minimum **7 characters** and at least **one special character**, defined once in
`auth.dto.ts` and mirrored in `apps/frontend/src/lib/password.ts`. `Password123`
is rejected; `Password@1` is accepted. "Special" means any non-alphanumeric
character rather than an allow-list of punctuation — an allow-list quietly
rejects good passwords containing characters nobody thought to include.

> Worth noting for the report: this **lowers** the previous minimum of 10
> characters. Length contributes more to strength than a mandatory symbol does,
> so the new rule is weaker than the old one. It was implemented as specified;
> raising the minimum back to 10 while keeping the symbol requirement would only
> mean changing `PASSWORD_MIN_LENGTH` in the two files above.

### Password visibility (Part 7)

There was never a toggle in this application. What appeared "inconsistently"
was the **browser's own** control: Edge and IE render `::-ms-reveal` inside
password inputs, Chrome and Firefox render nothing. `PasswordInput` now supplies
one control that behaves identically everywhere, `index.css` hides the native
one, and it is used on all five password fields (login, signup, confirm, reset,
confirm reset).

Behaviour: hidden while empty → appears on the first character → stays while
text remains → disappears when cleared, and clearing also re-masks, so a second
password typed after revealing a first one does not appear in plain text.

### Email notifications (Part 8)

| Trigger | Recipient | Subject |
| --- | --- | --- |
| Therapist–patient link | patient | Successfully connected with your therapist - Movera |
| Therapist–patient link | therapist | Patient successfully connected - Movera |
| Exercise assigned | patient | New exercise assigned on Movera |

Assignment emails carry patient name, therapist name, exercise name, the
prescription (sets × reps) and the due date.

> **One correction to the brief.** It described the link flow as "therapist
> generates a one-time code, patient joins using code". The implementation is
> the reverse: the **patient** generates the code and the **therapist** redeems
> it. That inversion was a deliberate fix — the superseded prototype let a
> therapist claim any patient by typing their email address, which meant anyone
> knowing an address could attach themselves to that person's clinical record.
> Consent flows from the patient. The flow was left alone and both emails are
> sent when the link is established, which is what you actually asked for.

Email failures never break the action that triggered them. A link or an
assignment is a committed database fact by the time mail is attempted; an
unreachable mail server produces a logged warning, not a failed request.

## 2. Database migration

One migration, purely additive:

```
prisma/migrations/20260829050000_add_email_verification_and_password_reset/
```

| Column | Type | Notes |
| --- | --- | --- |
| `emailVerified` | `BOOLEAN NOT NULL DEFAULT false` | |
| `emailVerifiedAt` | `TIMESTAMP(3)` | nullable |
| `verificationTokenHash` | `TEXT` | nullable, UNIQUE |
| `verificationTokenExpiry` | `TIMESTAMP(3)` | nullable |
| `resetPasswordTokenHash` | `TEXT` | nullable, UNIQUE |
| `resetPasswordTokenExpiry` | `TIMESTAMP(3)` | nullable |

No column dropped, no row deleted, no reset. Applied with `prisma migrate
deploy` against the live database.

**The backfill matters.** A bare `DEFAULT false` would have locked every
existing account — including your demo logins — out of an application they could
use a minute earlier. The migration marks all pre-existing users verified:

```sql
UPDATE "users" SET "emailVerified" = true,
       "emailVerifiedAt" = COALESCE("emailVerifiedAt", "createdAt")
WHERE "emailVerified" = false;
```

Verification is a rule for new signups, not a reason to revoke access already
granted. Result: 15 users preserved, 15 verified, 0 locked out.

The nullable UNIQUE columns are safe because PostgreSQL treats NULLs as
distinct, so any number of users may have no outstanding token.

```
$ npx prisma migrate status
3 migrations found in prisma/migrations
Database schema is up to date!
```

## 3. Environment variables added

All in `apps/backend/.env` (and documented in `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `Movera` | product name in emails and API docs |
| `APP_PUBLIC_URL` | first `FRONTEND_URL` entry | base URL for links inside emails |
| `SMTP_HOST` | `smtp.gmail.com` | |
| `SMTP_PORT` | `587` | 587 = STARTTLS, 465 = implicit TLS |
| `SMTP_USER` | *(blank)* | your Gmail address |
| `SMTP_PASSWORD` | *(blank)* | Gmail **app password** |
| `SMTP_FROM` | `Movera <…>` | shown as the sender |
| `EMAIL_VERIFICATION_TTL_HOURS` | `24` | |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | |

No credential is hard-coded anywhere.

**SMTP is optional in development and required in production.** Left blank, the
backend writes each message to its own log instead of sending it — so you can
copy a verification link out of the backend window and complete the whole flow
with no mail account at all. It says so loudly at startup:

```
[EmailService] SMTP is not configured - emails will be WRITTEN TO THIS LOG
instead of sent. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD in
apps/backend/.env to send real mail.
```

With `NODE_ENV=production` the process refuses to start without SMTP, because
silently not sending a verification email would lock every new user out.

## 4. Gmail SMTP setup

Gmail rejects your normal account password. You need an **app password**:

1. Go to **myaccount.google.com** → **Security**.
2. Turn on **2-Step Verification** if it is not already on. App passwords do
   not exist without it.
3. Still under Security, open **2-Step Verification** → **App passwords**.
4. Choose app **Mail**, device **Other**, name it `Movera`, and **Generate**.
5. Copy the 16-character password.
6. Put it in `apps/backend/.env`:

```
SMTP_USER=your.address@gmail.com
SMTP_PASSWORD=PASTE_YOUR_16_CHAR_APP_PASSWORD_HERE
SMTP_FROM=Movera <your.address@gmail.com>
```

7. Restart the backend. The log should read
   `SMTP configured: smtp.gmail.com:587 as your.address@gmail.com`.

Notes: paste the 16 characters with or without spaces, both work. `.env` is
git-ignored, so the app password never enters the repository. Gmail's free tier
allows roughly 500 messages a day — far beyond a demo. If sending fails with
`Invalid login`, the app password was mistyped or 2-Step Verification was
switched off again.

## 5. Startup scripts

Both in the **project root**, next to `apps/` and `services/`:

- `START_MOVERA.bat`
- `STOP_MOVERA.bat`

`START_MOVERA.bat` checks the PostgreSQL 18 service, compiles the backend,
opens three titled log windows (**Movera Backend**, **Movera Pose Service**,
**Movera Frontend**), polls each health endpoint, then opens
`http://localhost:5173`. It uses `%~dp0`, so it works wherever it is
double-clicked from. It never starts the old embedded database and never
touches port 55432. The Python virtual environment is used as-is; no package is
installed.

`STOP_MOVERA.bat` finds the process listening on each of Movera's own ports
(3000, 8000, 5173) and ends that process tree. It deliberately does **not** run
`taskkill /IM node.exe`, which would kill every Node process on the machine.
PostgreSQL is never touched.

> **A real bug found by testing this.** Git for Windows puts its own `find.exe`
> and `findstr` on `PATH`, and inside `cmd` those win over the Windows versions.
> A bare `sc query … | find "RUNNING"` therefore reached GNU `find`, failed with
> "No such file or directory", and reported a perfectly healthy PostgreSQL as
> stopped. Both scripts now call `%SystemRoot%\System32\…` explicitly. This
> would have hit your machine, not just the test environment, because you have
> Git installed.

## 6. Testing results

Every figure below was produced by running the suite, not estimated.

| Suite | Before | After | Result |
| --- | --- | --- | --- |
| Backend unit (Jest) | 46 | **60** | all pass |
| Backend e2e (real PostgreSQL) | 44 | **65** | all pass |
| Frontend (Vitest) | 38 | **52** | all pass |
| **Total** | 128 | **177** | all pass |

New coverage: 14 email-template tests (subjects, links in both HTML and text,
HTML escaping of user-supplied names), 21 e2e tests (verification, reset,
cross-role uniqueness, password policy), 14 frontend tests (toggle behaviour and
the policy examples from the brief).

### Verified live against the running stack

| Check | Result |
| --- | --- |
| Movera branding, tab title, navbar, auth screens | correct |
| M icon returns home | `/therapist/patients` → `/` → `/therapist` |
| Toggle hidden on empty field, appears on first character | correct |
| Duplicate email as the other role | 409, exact specified message |
| Login before verifying | 401 `EMAIL_NOT_VERIFIED` |
| Verification token stored | 64-hex SHA-256, never plaintext |
| Verify link | 200, account verified |
| Verify link replayed | 400, single use confirmed |
| Login after verifying | 200 |
| Forgot password, known vs unknown address | byte-identical responses |
| Reset with weak password | 400 |
| Reset with valid password | 200 |
| Old password after reset | 401 |
| New password after reset | 200 |
| Reset token after use | `NULL` |
| `START_MOVERA.bat` | three services up, all health checks green |

### SMTP delivery — verified live

Gmail is configured and real mail was sent and accepted:

```
[EmailService] SMTP configured: smtp.gmail.com:587 as hasnainzaidi2015@gmail.com
[EmailService] Sent "Verify your email address - Movera" to hasnainzaidi2015+movera@gmail.com
[EmailService] Sent "Reset your password - Movera" to hasnainzaidi2015@gmail.com
```

| Check | Result |
| --- | --- |
| `transporter.verify()` — TCP, STARTTLS and AUTH against smtp.gmail.com:587 | succeeded |
| Backend startup line | "SMTP configured", not the log-only warning |

All five templates were delivered by Gmail, driven through the real endpoints:

```
Sent "Verify your email address - Movera"                 -> +movera@gmail.com
Sent "Reset your password - Movera"                       -> hasnainzaidi2015@gmail.com
Sent "Verify your email address - Movera"                 -> +therapist@gmail.com
Sent "Patient successfully connected - Movera"            -> +therapist@gmail.com
Sent "Successfully connected with your therapist - Movera"-> +movera@gmail.com
Sent "New exercise assigned on Movera"                    -> +movera@gmail.com
```

The connection pair came from a real invite: the patient account generated a
code, the therapist account redeemed it through `POST /therapists/me/patients/link`,
and both sides were emailed. The assignment email came from a real
`POST /assignments`. Nothing was stubbed.

Two details worth recording. Gmail displays an app password as four groups of
four; the spaces are presentation only and are stripped before use. And
`SMTP_FROM` must be the authenticated account — Gmail rewrites a `From` that
does not match, so a mismatched sender silently becomes the account address
anyway.

A Gmail **plus-alias** (`you+anything@gmail.com`) delivers to the same inbox
while counting as a distinct address, which makes it the easiest way to test
signup repeatedly without exhausting real mailboxes.

## 7. Manual steps required

1. **Rotate the Gmail app password.** The one currently in `.env` was pasted
   into a chat transcript, so it should be treated as disclosed. Revoke it at
   *Google Account → Security → 2-Step Verification → App passwords*, generate
   a replacement, and put it in `apps/backend/.env`:

   ```
   SMTP_PASSWORD=<the new 16 characters>
   ```

   Then restart the backend. Nothing else changes — the address stays the same.

2. Optional: `npm run db:seed` if you want the demo data rebuilt. Not needed —
   existing accounts were backfilled as verified and still work with
   `DevPassword123!`.

Email itself needs no further setup: SMTP is configured and delivery is
verified.

### Outstanding, not blocking

- **The e2e suite shares `DATABASE_URL` with development**, so each run leaves
  test accounts behind (44 users now, from 15 real ones). It only ever inserts —
  no `deleteMany`, `TRUNCATE` or `DROP` — so nothing is destroyed, but the
  tests deserve their own database.
- `docs/SESSION_SUMMARY.md` from the previous phase was never written; the
  `/compact` interrupted it.
