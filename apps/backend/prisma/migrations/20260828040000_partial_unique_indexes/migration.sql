-- Filtered (partial) unique constraints.
--
-- Prisma's schema language cannot express "unique WHERE <condition>", so these
-- are declared here in raw SQL. They are real database constraints, not
-- application-layer checks: two concurrent requests cannot both win a race and
-- leave a patient with two ACTIVE plans.
--
-- The service layer still checks first, so users get a clean 409 rather than a
-- raw constraint violation - but the database is the backstop.

-- At most one ACTIVE rehabilitation plan per patient.
CREATE UNIQUE INDEX "rehabilitation_plans_one_active_per_patient"
  ON "rehabilitation_plans" ("patientId")
  WHERE "status" = 'ACTIVE';

-- At most one active rule config per exercise. The pose service resolves an
-- exercise's rules through this flag, so ambiguity here would mean two
-- patients silently analysed against different thresholds.
CREATE UNIQUE INDEX "exercise_rule_configs_one_active_per_exercise"
  ON "exercise_rule_configs" ("exerciseId")
  WHERE "isActive" = true;

-- A patient may hold only one unused, unexpired invite at a time is NOT
-- enforced here on purpose: expiry is time-based, and a partial index cannot
-- reference now(). SessionsService/PatientsService handles that case.
