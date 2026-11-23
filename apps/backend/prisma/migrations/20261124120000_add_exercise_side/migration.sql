-- Side-specific exercises.
--
-- Some exercises are performed one side at a time (one leg, one arm, a neck
-- bend in one direction). The patient chooses the side before starting, and
-- each side is recorded as its own session so left and right are tracked
-- independently.
--
-- Entirely additive and safe on PostgreSQL 16 and 18: two new enum types, one
-- defaulted column and one nullable column. Every existing exercise becomes
-- sideMode = NONE and every existing session keeps side = NULL, which is
-- exactly what they were.

CREATE TYPE "ExerciseSideMode" AS ENUM ('NONE', 'LIMB', 'DIRECTION', 'FACING');

CREATE TYPE "BodySide" AS ENUM ('LEFT', 'RIGHT');

ALTER TABLE "exercises"
  ADD COLUMN "sideMode" "ExerciseSideMode" NOT NULL DEFAULT 'NONE';

ALTER TABLE "exercise_sessions"
  ADD COLUMN "side" "BodySide";
