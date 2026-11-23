import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExerciseSideMode } from '@prisma/client';
import { EXERCISE_SEEDS } from '../../prisma/seed-exercises';

/**
 * The pose service's tests for the side-specific exercises run against a JSON
 * copy of their rule configs (services/pose-service/tests/fixtures). This
 * keeps that copy honest: if a threshold is changed here and not there, the
 * Python tests would be proving the wrong thing - so this fails instead.
 *
 * To refresh the fixture after a deliberate change, re-export the five
 * entries below from EXERCISE_SEEDS (slug -> {sideMode, recommendedView,
 * ruleConfig}).
 */
const FIXTURE = resolve(
  __dirname,
  '../../../../services/pose-service/tests/fixtures/side_exercise_rule_configs.json',
);

const SIDE_SLUGS = [
  'trunk-flexion',
  'neck-side-bend',
  'knee-extension',
  'standing-hip-extension',
  'elbow-extension',
];

describe('side-specific exercise library', () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<
    string,
    { sideMode: string; recommendedView: string; ruleConfig: unknown }
  >;

  it.each(SIDE_SLUGS)('%s matches the pose-service test fixture', (slug) => {
    const seed = EXERCISE_SEEDS.find((e) => e.slug === slug);
    expect(seed).toBeDefined();
    expect(fixture[slug]).toEqual(
      JSON.parse(
        JSON.stringify({
          sideMode: seed!.sideMode,
          recommendedView: seed!.recommendedView,
          ruleConfig: seed!.ruleConfig,
        }),
      ),
    );
  });

  it.each(SIDE_SLUGS)('%s is side-specific, active and analysable', (slug) => {
    const seed = EXERCISE_SEEDS.find((e) => e.slug === slug)!;
    expect(seed.isActive).toBe(true);
    expect(seed.sideMode).toBeDefined();
    expect(seed.sideMode).not.toBe(ExerciseSideMode.NONE);
    expect(seed.ruleConfig?.movementStateConfig).toBeDefined();
  });

  it('leaves the original five exercises without a side', () => {
    for (const slug of [
      'squat',
      'bicep-curl',
      'shoulder-abduction',
      'straight-leg-raise',
      'static-posture',
    ]) {
      const seed = EXERCISE_SEEDS.find((e) => e.slug === slug)!;
      expect(seed.sideMode ?? ExerciseSideMode.NONE).toBe(ExerciseSideMode.NONE);
      expect(JSON.stringify(seed.ruleConfig)).not.toContain('{side}');
    }
  });

  it('uses only feedback codes the ingest endpoint accepts', async () => {
    const { KNOWN_ERROR_CODES } = await import('../internal/internal.service');
    for (const seed of EXERCISE_SEEDS) {
      for (const rule of seed.ruleConfig?.postureRules ?? []) {
        expect(KNOWN_ERROR_CODES.has(String(rule.code))).toBe(true);
      }
    }
  });
});
