import { Injectable } from '@nestjs/common';
import { AppError, AppErrorCode } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The exercise library is SYSTEM-MANAGED for the MVP.
 *
 * There is no therapist-facing mutation endpoint, deliberately. ExerciseRuleConfig
 * holds the computer-vision thresholds, and those are global: one therapist
 * editing "squat" would silently change how every patient in the system is
 * analysed. Therapists configure sets, reps, difficulty, schedule and
 * instructions on the ASSIGNMENT instead, which is per-patient and safe.
 *
 * Per-assignment threshold overrides are noted as a stretch feature in
 * docs/NEXT_STEPS.md.
 */
@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(includeInactive = false) {
    const exercises = await this.prisma.exercise.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        ruleConfigs: {
          where: { isActive: true },
          select: { version: true, validationStatus: true },
          take: 1,
        },
      },
    });

    return exercises.map((exercise) => ({
      id: exercise.id,
      slug: exercise.slug,
      name: exercise.name,
      description: exercise.description,
      category: exercise.category,
      difficulty: exercise.difficulty,
      targetBodyArea: exercise.targetBodyArea,
      recommendedView: exercise.recommendedView,
      defaultSets: exercise.defaultSets,
      defaultReps: exercise.defaultReps,
      goalType: exercise.goalType,
      defaultHoldSeconds: exercise.defaultHoldSeconds,
      isActive: exercise.isActive,
      // An exercise without an active rule config cannot be analysed, so the
      // UI must be able to tell before a therapist prescribes it.
      analysisAvailable: exercise.ruleConfigs.length > 0,
    }));
  }

  async findBySlug(slug: string) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { slug },
      include: {
        ruleConfigs: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!exercise) {
      throw AppError.notFound(
        AppErrorCode.EXERCISE_NOT_FOUND,
        'That exercise does not exist.',
      );
    }

    const ruleConfig = exercise.ruleConfigs[0];

    return {
      id: exercise.id,
      slug: exercise.slug,
      name: exercise.name,
      description: exercise.description,
      instructions: exercise.instructions,
      category: exercise.category,
      difficulty: exercise.difficulty,
      targetBodyArea: exercise.targetBodyArea,
      recommendedView: exercise.recommendedView,
      framingInstructions: exercise.framingInstructions,
      defaultSets: exercise.defaultSets,
      defaultReps: exercise.defaultReps,
      goalType: exercise.goalType,
      defaultHoldSeconds: exercise.defaultHoldSeconds,
      isActive: exercise.isActive,
      analysis: ruleConfig
        ? {
            version: ruleConfig.version,
            requiredLandmarks: ruleConfig.requiredLandmarks,
            minVisibility: ruleConfig.minVisibility,
            repCorrectnessThreshold: ruleConfig.repCorrectnessThreshold,
            validationStatus: ruleConfig.validationStatus,
            // Surfaced in the UI so nobody mistakes these for clinical standards.
            disclaimer:
              'Prototype thresholds requiring physiotherapist validation before clinical use.',
          }
        : null,
    };
  }
}
