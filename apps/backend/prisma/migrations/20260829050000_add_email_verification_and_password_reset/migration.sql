-- Email verification and password reset.
--
-- Purely additive: no column is dropped, no data is deleted, and every new
-- column is nullable or has a default, so the migration is safe to run against
-- the live database.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "resetPasswordTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "resetPasswordTokenHash" TEXT,
ADD COLUMN     "verificationTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "verificationTokenHash" TEXT;

-- Backfill: every account that existed BEFORE verification was introduced is
-- treated as verified.
--
-- Without this, the column default of false would immediately lock every
-- existing user - including the seeded demo accounts - out of an application
-- they could log into a minute earlier. Verification is a rule for new
-- signups; it is not a reason to revoke access that was already granted.
--
-- This statement is written to affect only rows present at migration time.
-- Accounts created afterwards go through the real verification flow.
UPDATE "users"
SET "emailVerified" = true,
    "emailVerifiedAt" = COALESCE("emailVerifiedAt", "createdAt")
WHERE "emailVerified" = false;

-- CreateIndex
-- Nullable unique columns: PostgreSQL treats NULLs as distinct, so any number
-- of users may simultaneously have no outstanding token.
CREATE UNIQUE INDEX "users_verificationTokenHash_key" ON "users"("verificationTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "users_resetPasswordTokenHash_key" ON "users"("resetPasswordTokenHash");
