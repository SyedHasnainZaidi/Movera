-- Hold-based exercises.
--
-- Postural correction has no countable repetition: there is no honest point at
-- which one "rep" of standing up straight ends. It was previously modelled as a
-- relax-then-straighten cycle, which produced a rep count that meant nothing
-- clinically. This migration gives the schema a way to say so.
--
-- Entirely additive. Every new column is nullable or defaulted, so existing
-- rows keep their exact meaning: goalType defaults to REPS, which is what every
-- current exercise, assignment and session already is.

CREATE TYPE "ExerciseGoalType" AS ENUM ('REPS', 'HOLD');

ALTER TABLE "exercises"
  ADD COLUMN "goalType" "ExerciseGoalType" NOT NULL DEFAULT 'REPS',
  ADD COLUMN "defaultHoldSeconds" INTEGER;

ALTER TABLE "exercise_assignments"
  ADD COLUMN "holdSeconds" INTEGER;

ALTER TABLE "exercise_sessions"
  ADD COLUMN "goalType" "ExerciseGoalType" NOT NULL DEFAULT 'REPS',
  ADD COLUMN "targetHoldSec" INTEGER,
  ADD COLUMN "heldSec" DOUBLE PRECISION,
  ADD COLUMN "holdSummary" JSONB;

-- Reclassify the one exercise this was built for. 60 seconds of accumulated
-- correct alignment is a PROTOTYPE DEFAULT requiring physiotherapist review,
-- consistent with every other threshold in the system.
UPDATE "exercises"
SET "goalType" = 'HOLD',
    "defaultHoldSeconds" = 60
WHERE "slug" = 'static-posture';

-- Sessions already recorded against static-posture keep goalType = REPS on
-- purpose. They were analysed and scored as repetitions, and rewriting them to
-- HOLD would describe them as something that never happened.
