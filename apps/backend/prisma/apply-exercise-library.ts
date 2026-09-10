/**
 * Apply EXERCISE_SEEDS to the live database WITHOUT deleting anything.
 *
 *   npx ts-node -T prisma/apply-exercise-library.ts
 *
 * Why this exists separately from seed.ts
 * ---------------------------------------
 * `prisma/seed.ts` starts by deleting every session, report, assignment and
 * exercise so it can rebuild a known demo dataset. That is correct for seeding
 * an empty database and completely wrong for a database with real recorded
 * sessions in it. This script updates the exercise library in place:
 *
 *   * exercises are matched by slug and UPDATED, never recreated, so every
 *     foreign key from exercise_assignments and exercise_sessions survives;
 *   * a renamed exercise is matched through RENAMES below, so the row keeps
 *     its id and its history rather than becoming an orphan beside a new one;
 *   * a changed rule config is added as a NEW VERSION and the previous one is
 *     deactivated, never edited. A completed session records the version that
 *     judged it, and rewriting that version's thresholds would silently
 *     falsify historical reports.
 *
 * Safe to run repeatedly: an unchanged config is left alone.
 */

import {
  PrismaClient,
  Prisma,
  ExerciseGoalType,
  ValidationStatus,
} from '@prisma/client';
import { EXERCISE_SEEDS, type RuleConfigSeed } from './seed-exercises';

const prisma = new PrismaClient();

/**
 * Slug changes. Old slug -> new slug.
 *
 * `shoulder-raise` was the MediaPipe-era name for what the YOLOv8 prototype
 * calls Shoulder Abduction (`analysis/shoulder_abduction.py`). Renaming the
 * existing row keeps the assignments and sessions already attached to it.
 */
const RENAMES: Record<string, string> = {
  'shoulder-raise': 'shoulder-abduction',
};

/**
 * JSON.stringify with object keys sorted, recursively.
 *
 * PostgreSQL's `jsonb` does not preserve key order - it stores keys sorted by
 * length then bytewise - so a config read back from the database serialises in
 * a different order than the seed that wrote it. A plain JSON.stringify
 * comparison therefore reported EVERY config as changed, which made this
 * script bump every rule config version on every run despite its promise to
 * leave unchanged ones alone. Versions are meant to mark real threshold
 * changes; inflating them makes a session's recorded version meaningless.
 *
 * Arrays keep their order, because in a rule config it is meaningful.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(',')}}`;
}

/** Compares the parts of a rule config that actually affect analysis. */
function configEquals(
  stored: {
    requiredLandmarks: Prisma.JsonValue;
    angleDefinitions: Prisma.JsonValue;
    movementStateConfig: Prisma.JsonValue;
    postureRules: Prisma.JsonValue;
    minVisibility: number;
    repCorrectnessThreshold: number;
  },
  seed: RuleConfigSeed,
): boolean {
  const norm = (value: unknown) => canonical(value ?? null);
  // requiredLandmarks is a Json column, so it arrives as JsonValue and has to
  // be narrowed before it can be sorted.
  const storedLandmarks = Array.isArray(stored.requiredLandmarks)
    ? [...stored.requiredLandmarks].map(String).sort()
    : null;
  return (
    norm(storedLandmarks) === norm([...seed.requiredLandmarks].sort()) &&
    norm(stored.angleDefinitions) === norm(seed.angleDefinitions) &&
    norm(stored.movementStateConfig) === norm(seed.movementStateConfig) &&
    norm(stored.postureRules) === norm(seed.postureRules) &&
    stored.minVisibility === seed.minVisibility &&
    stored.repCorrectnessThreshold === seed.repCorrectnessThreshold
  );
}

async function main(): Promise<void> {
  console.log('Applying exercise library (non-destructive)\n');

  for (const seed of EXERCISE_SEEDS) {
    // Resolve the row: current slug first, then any slug that was renamed to it.
    let exercise = await prisma.exercise.findUnique({
      where: { slug: seed.slug },
    });

    if (!exercise) {
      const oldSlug = Object.keys(RENAMES).find(
        (from) => RENAMES[from] === seed.slug,
      );
      if (oldSlug) {
        exercise = await prisma.exercise.findUnique({
          where: { slug: oldSlug },
        });
        if (exercise) {
          console.log(`  ${oldSlug} -> ${seed.slug}  (renamed, id preserved)`);
        }
      }
    }

    const data = {
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      instructions: seed.instructions,
      category: seed.category,
      difficulty: seed.difficulty,
      targetBodyArea: seed.targetBodyArea,
      recommendedView: seed.recommendedView,
      framingInstructions: seed.framingInstructions,
      defaultSets: seed.defaultSets,
      defaultReps: seed.defaultReps,
      goalType: seed.goalType ?? ExerciseGoalType.REPS,
      defaultHoldSeconds: seed.defaultHoldSeconds ?? null,
      isActive: seed.isActive,
    };

    if (exercise) {
      exercise = await prisma.exercise.update({
        where: { id: exercise.id },
        data,
      });
      console.log(`  updated  ${seed.slug}`);
    } else {
      exercise = await prisma.exercise.create({ data });
      console.log(`  created  ${seed.slug}`);
    }

    if (!seed.ruleConfig) {
      console.log('           (no rule config - not analysable)');
      continue;
    }

    const configs = await prisma.exerciseRuleConfig.findMany({
      where: { exerciseId: exercise.id },
      orderBy: { version: 'desc' },
    });
    const active = configs.find((c) => c.isActive);

    if (active && configEquals(active, seed.ruleConfig)) {
      console.log(`           rule config v${active.version} already current`);
      continue;
    }

    const nextVersion = configs.length
      ? Math.max(...configs.map((c) => c.version)) + 1
      : seed.ruleConfig.version;

    // One transaction: the partial unique index allows only one active config
    // per exercise, so the old one must be stood down before the new one is
    // inserted, and a crash between the two must not leave the exercise with
    // no active config at all.
    await prisma.$transaction([
      prisma.exerciseRuleConfig.updateMany({
        where: { exerciseId: exercise.id, isActive: true },
        data: { isActive: false },
      }),
      prisma.exerciseRuleConfig.create({
        data: {
          exerciseId: exercise.id,
          version: nextVersion,
          isActive: true,
          requiredLandmarks: seed.ruleConfig.requiredLandmarks,
          angleDefinitions: seed.ruleConfig
            .angleDefinitions as unknown as Prisma.InputJsonValue,
          // A HOLD exercise declares no movement cycle. The column is NOT
          // NULL, so the JSON value `null` is stored - which the pose service
          // reads as "no cycle" rather than as an empty one.
          movementStateConfig: (seed.ruleConfig.movementStateConfig ??
            Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
          postureRules: seed.ruleConfig
            .postureRules as unknown as Prisma.InputJsonValue,
          minVisibility: seed.ruleConfig.minVisibility,
          repCorrectnessThreshold: seed.ruleConfig.repCorrectnessThreshold,
          validationStatus:
            ValidationStatus.PROTOTYPE_DEFAULT_REQUIRES_PHYSIOTHERAPIST_REVIEW,
        },
      }),
    ]);

    console.log(
      `           rule config v${nextVersion} activated` +
        (active ? ` (v${active.version} retired)` : ''),
    );
  }

  console.log('\nDone. No rows were deleted.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
