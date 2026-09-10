/**
 * Development seed.
 *
 * ============================ DEVELOPMENT ONLY ============================
 * Every account below uses a shared, publicly documented password. This data
 * exists to make the application demonstrable on a developer machine. It must
 * never be run against anything resembling a production database.
 * ==========================================================================
 *
 * The scenario is a small but complete clinical picture, so every screen has
 * something real to show: one therapist, two patients (one active with history,
 * one newly registered and unlinked), an active plan, three assignments, and
 * fourteen days of completed sessions with per-repetition results, structured
 * errors and generated reports.
 *
 * Session history is generated with a fixed pseudo-random seed so that runs are
 * reproducible - a demo looks the same today as it did yesterday.
 */

import { hash } from '@node-rs/argon2';
import {
  AssignmentStatus,
  AssessmentStatus,
  Difficulty,
  ExerciseGoalType,
  FeedbackType,
  LinkStatus,
  NotificationType,
  PlanStatus,
  Prisma,
  PrismaClient,
  SessionStatus,
  Severity,
  UserRole,
} from '@prisma/client';
import { EXERCISE_SEEDS } from './seed-exercises';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'DevPassword123!';
const TIMEZONE = 'Asia/Karachi';

/** Deterministic PRNG (mulberry32) so seeded history is reproducible. */
function makeRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20260828);

function daysAgo(days: number, hour = 9): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

async function main(): Promise<void> {
  console.log('Seeding development data...\n');

  // Order matters: children before parents.
  await prisma.$transaction([
    prisma.sessionError.deleteMany(),
    prisma.sessionMetric.deleteMany(),
    prisma.sessionReport.deleteMany(),
    prisma.repResult.deleteMany(),
    prisma.exerciseSession.deleteMany(),
    prisma.therapistFeedback.deleteMany(),
    prisma.clinicalAssessment.deleteMany(),
    prisma.exerciseAssignment.deleteMany(),
    prisma.rehabilitationPlan.deleteMany(),
    prisma.patientLinkInvite.deleteMany(),
    prisma.therapistPatient.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.progressEstimate.deleteMany(),
    prisma.exerciseRuleConfig.deleteMany(),
    prisma.exercise.deleteMany(),
    prisma.patientProfile.deleteMany(),
    prisma.therapistProfile.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  console.log('  Cleared existing data');

  const passwordHash = await hash(DEV_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  // --- exercise library -------------------------------------------------
  const exercisesBySlug = new Map<string, string>();
  for (const seed of EXERCISE_SEEDS) {
    const exercise = await prisma.exercise.create({
      data: {
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
      },
    });
    exercisesBySlug.set(seed.slug, exercise.id);

    if (seed.ruleConfig) {
      await prisma.exerciseRuleConfig.create({
        data: {
          exerciseId: exercise.id,
          version: seed.ruleConfig.version,
          requiredLandmarks: seed.ruleConfig.requiredLandmarks,
          // Prisma types Json columns as InputJsonValue, which does not accept
          // an open Record<string, unknown>. The seed shapes are fixed and
          // validated by RuleConfig.from_payload in the pose service, so the
          // cast is asserting a shape this file already guarantees.
          angleDefinitions: seed.ruleConfig
            .angleDefinitions as unknown as Prisma.InputJsonValue,
          // Null for a HOLD exercise, which has no movement cycle to describe.
          movementStateConfig: (seed.ruleConfig.movementStateConfig ??
            Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
          postureRules: seed.ruleConfig
            .postureRules as unknown as Prisma.InputJsonValue,
          minVisibility: seed.ruleConfig.minVisibility,
          repCorrectnessThreshold: seed.ruleConfig.repCorrectnessThreshold,
          isActive: true,
          // Recorded explicitly on every row, so the provenance of these
          // numbers is visible in the database itself.
          validationStatus:
            'PROTOTYPE_DEFAULT_REQUIRES_PHYSIOTHERAPIST_REVIEW',
        },
      });
    }
  }
  console.log(
    `  Created ${EXERCISE_SEEDS.length} exercises (${
      EXERCISE_SEEDS.filter((e) => e.ruleConfig).length
    } analysable)`,
  );

  // --- people -----------------------------------------------------------
  const therapistUser = await prisma.user.create({
    data: {
      email: 'therapist@example.com',
      passwordHash,
      // Demo accounts are pre-verified: they exist to be signed into
      // immediately, and there is no mailbox to receive a verification link.
      emailVerified: true,
      emailVerifiedAt: new Date(),
      role: UserRole.THERAPIST,
      firstName: 'Ayesha',
      lastName: 'Khan',
      timezone: TIMEZONE,
      therapistProfile: {
        create: {
          licenseNumber: 'DEV-PT-00417',
          specialization: 'Musculoskeletal rehabilitation',
          yearsExperience: 9,
          bio: 'Physiotherapist working in post-operative lower-limb and shoulder rehabilitation.',
        },
      },
    },
    include: { therapistProfile: true },
  });
  const therapistId = therapistUser.therapistProfile!.id;

  const patient1 = await prisma.user.create({
    data: {
      email: 'patient1@example.com',
      passwordHash,
      // Demo accounts are pre-verified: they exist to be signed into
      // immediately, and there is no mailbox to receive a verification link.
      emailVerified: true,
      emailVerifiedAt: new Date(),
      role: UserRole.PATIENT,
      firstName: 'Ahmed',
      lastName: 'Raza',
      timezone: TIMEZONE,
      patientProfile: {
        create: {
          phone: '+92 300 1122334',
          dateOfBirth: new Date('1996-03-22'),
          conditionSummary:
            'Post-operative ACL reconstruction, left knee. Week 8 of rehabilitation.',
        },
      },
    },
    include: { patientProfile: true },
  });
  const patient1Id = patient1.patientProfile!.id;

  // Deliberately NOT linked: proves the invite flow is required, and gives the
  // empty-state screens something real to render.
  const patient2 = await prisma.user.create({
    data: {
      email: 'patient2@example.com',
      passwordHash,
      // Demo accounts are pre-verified: they exist to be signed into
      // immediately, and there is no mailbox to receive a verification link.
      emailVerified: true,
      emailVerifiedAt: new Date(),
      role: UserRole.PATIENT,
      firstName: 'Sana',
      lastName: 'Malik',
      timezone: TIMEZONE,
      patientProfile: {
        create: {
          phone: '+92 301 9988776',
          dateOfBirth: new Date('1991-11-05'),
          conditionSummary: 'Right shoulder impingement, conservative management.',
        },
      },
    },
    include: { patientProfile: true },
  });
  const patient2Id = patient2.patientProfile!.id;

  await prisma.therapistPatient.create({
    data: {
      therapistId,
      patientId: patient1Id,
      status: LinkStatus.ACTIVE,
      isPrimary: true,
    },
  });
  console.log('  Created 1 therapist and 2 patients (patient1 linked)');

  // --- plan and assignments --------------------------------------------
  const plan = await prisma.rehabilitationPlan.create({
    data: {
      patientId: patient1Id,
      therapistId,
      title: 'Lower Limb Rehabilitation - Phase 2',
      goals:
        'Restore symmetrical knee flexion through range, rebuild quadriceps endurance, and progress toward unsupported stair descent.',
      startDate: daysAgo(21),
      endDate: daysAgo(-28),
      status: PlanStatus.ACTIVE,
      notes:
        'Progressing well. Reassess squat depth tolerance at the next in-person appointment.',
    },
  });

  const squatAssignment = await prisma.exerciseAssignment.create({
    data: {
      planId: plan.id,
      patientId: patient1Id,
      therapistId,
      exerciseId: exercisesBySlug.get('squat')!,
      targetSets: 3,
      repsPerSet: 10,
      difficulty: Difficulty.MEDIUM,
      frequencyPerWeek: 5,
      scheduledDays: [1, 2, 3, 4, 5],
      preferredTime: '09:00',
      startDate: daysAgo(21),
      status: AssignmentStatus.ACTIVE,
      instructions:
        'Keep your heels flat and pause for one second at the bottom of each repetition.',
    },
  });

  await prisma.exerciseAssignment.create({
    data: {
      planId: plan.id,
      patientId: patient1Id,
      therapistId,
      exerciseId: exercisesBySlug.get('bicep-curl')!,
      targetSets: 3,
      repsPerSet: 12,
      difficulty: Difficulty.EASY,
      frequencyPerWeek: 3,
      scheduledDays: [2, 4, 6],
      startDate: daysAgo(14),
      status: AssignmentStatus.ACTIVE,
      instructions: 'Control the lowering phase - take about three seconds.',
    },
  });

  await prisma.exerciseAssignment.create({
    data: {
      planId: plan.id,
      patientId: patient1Id,
      therapistId,
      exerciseId: exercisesBySlug.get('shoulder-raise')!,
      targetSets: 2,
      repsPerSet: 10,
      difficulty: Difficulty.EASY,
      frequencyPerWeek: 3,
      scheduledDays: [1, 3, 5],
      startDate: daysAgo(7),
      status: AssignmentStatus.ACTIVE,
    },
  });
  console.log('  Created 1 active plan and 3 assignments');

  // --- session history --------------------------------------------------
  // Twelve squat sessions over three weeks, improving gradually, so the
  // progress charts show a real trend rather than a flat line.
  const sessionDays = [20, 18, 17, 15, 14, 12, 10, 8, 7, 5, 3, 1];
  let sessionsCreated = 0;
  let repsCreated = 0;

  for (const [index, dayOffset] of sessionDays.entries()) {
    const progress = index / (sessionDays.length - 1); // 0 -> 1 over time
    const baseScore = 62 + progress * 26; // improves from ~62 to ~88
    const startedAt = daysAgo(dayOffset, 9);
    const targetTotalReps = 30;

    // Early sessions are cut short more often - fatigue and confidence.
    const completedReps =
      index < 3
        ? 18 + Math.floor(random() * 6)
        : index < 8
          ? 24 + Math.floor(random() * 6)
          : 28 + Math.floor(random() * 3);

    const durationSec = 180 + Math.floor(random() * 120);
    const endedAt = new Date(startedAt.getTime() + durationSec * 1000);

    const session = await prisma.exerciseSession.create({
      data: {
        patientId: patient1Id,
        assignmentId: squatAssignment.id,
        exerciseId: exercisesBySlug.get('squat')!,
        ruleConfigVersion: 1,
        status: SessionStatus.COMPLETED,
        targetSets: 3,
        repsPerSet: 10,
        targetTotalReps,
        startedAt,
        activatedAt: new Date(startedAt.getTime() + 15_000),
        endedAt,
        durationSec,
      },
    });

    const repScores: number[] = [];
    const confidences: number[] = [];
    const kneeMins: number[] = [];
    const kneeMaxes: number[] = [];
    const kneeMeans: number[] = [];
    const errorTally = new Map<string, number>();
    let correctReps = 0;

    for (let repNumber = 1; repNumber <= completedReps; repNumber += 1) {
      // Form drifts slightly as the session goes on.
      const fatigue = (repNumber / completedReps) * 6;
      const score = Math.max(
        30,
        Math.min(100, baseScore - fatigue + (random() * 14 - 7)),
      );
      const confidence = 0.82 + random() * 0.15;
      const correct = score >= 70;
      if (correct) correctReps += 1;

      const kneeMin = 118 - progress * 26 + random() * 8; // depth improves
      const kneeMax = 168 + random() * 6;
      const kneeMean = (kneeMin + kneeMax) / 2;
      const trunkLean = 18 + (1 - progress) * 18 + random() * 8;

      repScores.push(score);
      confidences.push(confidence);
      kneeMins.push(kneeMin);
      kneeMaxes.push(kneeMax);
      kneeMeans.push(kneeMean);

      const repStart = new Date(
        startedAt.getTime() + 15_000 + (repNumber - 1) * 6_000,
      );
      const repEnd = new Date(repStart.getTime() + 3_500);

      const rep = await prisma.repResult.create({
        data: {
          sessionId: session.id,
          repNumber,
          setNumber: Math.min(3, Math.floor((repNumber - 1) / 10) + 1),
          startedAt: repStart,
          completedAt: repEnd,
          correct,
          score: Math.round(score * 10) / 10,
          trackingConfidence: Math.round(confidence * 1000) / 1000,
          angleSummary: {
            knee: {
              min: Math.round(kneeMin * 10) / 10,
              max: Math.round(kneeMax * 10) / 10,
              mean: Math.round(kneeMean * 10) / 10,
            },
            trunkLean: {
              min: Math.round((trunkLean - 6) * 10) / 10,
              max: Math.round(trunkLean * 10) / 10,
              mean: Math.round((trunkLean - 3) * 10) / 10,
            },
          },
          ingestKey: `${session.id}:${repNumber}`,
        },
      });
      repsCreated += 1;

      const errors: { code: string; severity: Severity }[] = [];
      if (kneeMin > 110) {
        errors.push({ code: 'INSUFFICIENT_DEPTH', severity: Severity.WARNING });
      }
      if (trunkLean > 45) {
        errors.push({ code: 'TRUNK_LEAN', severity: Severity.WARNING });
      }

      for (const error of errors) {
        const occurrences = 2 + Math.floor(random() * 5);
        errorTally.set(
          error.code,
          (errorTally.get(error.code) ?? 0) + occurrences,
        );
        await prisma.sessionError.create({
          data: {
            sessionId: session.id,
            repResultId: rep.id,
            code: error.code,
            severity: error.severity,
            occurrences,
          },
        });
      }
    }

    // Totals computed the same way ReportsService computes them, so seeded
    // history is consistent with anything the live pipeline produces.
    const performanceScore =
      Math.round(
        (repScores.reduce((a, b) => a + b, 0) / repScores.length) * 10,
      ) / 10;
    const avgConfidence =
      Math.round(
        (confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000,
      ) / 1000;
    const completionRatio =
      Math.round((completedReps / targetTotalReps) * 1000) / 10;

    await prisma.exerciseSession.update({
      where: { id: session.id },
      data: {
        totalReps: completedReps,
        correctReps,
        incorrectReps: completedReps - correctReps,
        performanceScore,
        avgTrackingConfidence: avgConfidence,
      },
    });

    const commonErrors = [...errorTally.entries()]
      .map(([code, occurrences]) => ({
        code,
        severity: 'WARNING',
        occurrences,
      }))
      .sort((a, b) => b.occurrences - a.occurrences);

    await prisma.sessionReport.create({
      data: {
        sessionId: session.id,
        generatedAt: endedAt,
        summary:
          `Completed ${completedReps} of ${targetTotalReps} prescribed repetitions (${completionRatio}%) of Bodyweight Squat. ` +
          `${correctReps} repetition${correctReps === 1 ? '' : 's'} met the configured form criteria, giving an average form score of ${performanceScore}/100. ` +
          (commonErrors[0]
            ? `The most frequently detected issue was ${commonErrors[0].code.toLowerCase().replace(/_/g, ' ')}.`
            : 'No recurring form issues were detected.'),
        angleStats: {
          knee: {
            min: Math.round(Math.min(...kneeMins) * 10) / 10,
            max: Math.round(Math.max(...kneeMaxes) * 10) / 10,
            mean:
              Math.round(
                (kneeMeans.reduce((a, b) => a + b, 0) / kneeMeans.length) * 10,
              ) / 10,
          },
        },
        commonErrors,
        trackingSummary: {
          meanConfidence: avgConfidence,
          repsAnalysed: completedReps,
          completionRatio,
        },
      },
    });

    await prisma.sessionMetric.createMany({
      data: [
        { sessionId: session.id, key: 'completion_ratio', value: completionRatio },
        { sessionId: session.id, key: 'duration_sec', value: durationSec },
        {
          sessionId: session.id,
          key: 'correct_rep_ratio',
          value: Math.round((correctReps / completedReps) * 1000) / 10,
        },
      ],
    });

    sessionsCreated += 1;
  }
  console.log(
    `  Created ${sessionsCreated} completed sessions with ${repsCreated} repetitions and reports`,
  );

  // --- clinical follow-up ----------------------------------------------
  await prisma.clinicalAssessment.create({
    data: {
      patientId: patient1Id,
      therapistId,
      assessedAt: daysAgo(14),
      painScore: 4,
      romNotes:
        'Active knee flexion approximately 115 degrees, passive to 125. Extension full and symmetrical.',
      findings:
        'Quadriceps bulk still reduced on the operated side. Squat depth limited by discomfort rather than by range.',
      notes: 'Continue current loading. Reassess in two weeks.',
      status: AssessmentStatus.FINALISED,
    },
  });

  await prisma.clinicalAssessment.create({
    data: {
      patientId: patient1Id,
      therapistId,
      assessedAt: daysAgo(3),
      painScore: 2,
      romNotes: 'Active knee flexion approximately 128 degrees. Extension full.',
      findings:
        'Noticeable improvement in squat depth and control. Trunk position more upright through the descent.',
      notes: 'Consider progressing to single-leg work at the next review.',
      status: AssessmentStatus.FINALISED,
    },
  });

  await prisma.therapistFeedback.create({
    data: {
      therapistId,
      patientId: patient1Id,
      type: FeedbackType.EXERCISE,
      body: 'Your squat depth is improving steadily. Focus on keeping your trunk stable as you come back up.',
      createdAt: daysAgo(5),
    },
  });

  await prisma.therapistFeedback.create({
    data: {
      therapistId,
      patientId: patient1Id,
      type: FeedbackType.PLAN,
      body: 'Good consistency over the last two weeks. Keep the current plan going and we will review on Friday.',
      createdAt: daysAgo(1),
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: patient1.id,
        type: NotificationType.THERAPIST_FEEDBACK,
        title: 'New feedback from your physiotherapist',
        message: 'Ayesha Khan left a note about your squat technique.',
        read: false,
      },
      {
        userId: patient1.id,
        type: NotificationType.ASSIGNMENT_CREATED,
        title: 'New exercise assigned',
        message: 'Lateral Shoulder Raise: 2 sets of 10 repetitions.',
        read: false,
      },
      {
        userId: patient1.id,
        type: NotificationType.SESSION_COMPLETED,
        title: 'Session recorded',
        message: 'Your Bodyweight Squat session has been saved.',
        read: true,
      },
      {
        userId: therapistUser.id,
        type: NotificationType.SESSION_COMPLETED,
        title: 'Session completed',
        message: 'Ahmed Raza completed Bodyweight Squat.',
        read: false,
      },
    ],
  });
  console.log('  Created assessments, feedback and notifications');

  console.log(`
=============================================================
  DEVELOPMENT ACCOUNTS - NOT FOR PRODUCTION USE
=============================================================
  Therapist   therapist@example.com   ${DEV_PASSWORD}
  Patient A   patient1@example.com    ${DEV_PASSWORD}   (linked, 12 sessions)
  Patient B   patient2@example.com    ${DEV_PASSWORD}   (unlinked - use the invite flow)

  These credentials are published in the repository and are
  intended solely for local development and demonstration.
=============================================================
`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
