-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'THERAPIST', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "CameraView" AS ENUM ('FRONT', 'SIDE', 'FRONT_OBLIQUE');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('CREATED', 'ACTIVE', 'FINALIZING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('PROTOTYPE_DEFAULT_REQUIRES_PHYSIOTHERAPIST_REVIEW', 'REVIEWED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNMENT_CREATED', 'PLAN_UPDATED', 'SESSION_COMPLETED', 'THERAPIST_FEEDBACK', 'EXERCISE_REMINDER', 'MISSED_SESSION', 'PATIENT_LINKED');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('SESSION', 'EXERCISE', 'PLAN', 'GENERAL');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'FINALISED');

-- CreateEnum
CREATE TYPE "TrendDirection" AS ENUM ('IMPROVING', 'STABLE', 'DECLINING', 'INSUFFICIENT_DATA');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT,
    "conditionSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapist_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "specialization" TEXT,
    "bio" TEXT,
    "yearsExperience" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "therapist_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapist_patients" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),

    CONSTRAINT "therapist_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_link_invites" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_link_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "targetBodyArea" TEXT NOT NULL,
    "recommendedView" "CameraView" NOT NULL DEFAULT 'SIDE',
    "framingInstructions" TEXT NOT NULL,
    "defaultSets" INTEGER NOT NULL DEFAULT 3,
    "defaultReps" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_rule_configs" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "requiredLandmarks" JSONB NOT NULL,
    "angleDefinitions" JSONB NOT NULL,
    "movementStateConfig" JSONB NOT NULL,
    "postureRules" JSONB NOT NULL,
    "minVisibility" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "repCorrectnessThreshold" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "validationStatus" "ValidationStatus" NOT NULL DEFAULT 'PROTOTYPE_DEFAULT_REQUIRES_PHYSIOTHERAPIST_REVIEW',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_rule_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rehabilitation_plans" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goals" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rehabilitation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_assignments" (
    "id" TEXT NOT NULL,
    "planId" TEXT,
    "patientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "targetSets" INTEGER NOT NULL,
    "repsPerSet" INTEGER NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "frequencyPerWeek" INTEGER,
    "scheduledDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "preferredTime" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "instructions" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_sessions" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "ruleConfigVersion" INTEGER NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'CREATED',
    "targetSets" INTEGER NOT NULL,
    "repsPerSet" INTEGER NOT NULL,
    "targetTotalReps" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "totalReps" INTEGER NOT NULL DEFAULT 0,
    "correctReps" INTEGER NOT NULL DEFAULT 0,
    "incorrectReps" INTEGER NOT NULL DEFAULT 0,
    "performanceScore" DOUBLE PRECISION,
    "avgTrackingConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rep_results" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "repNumber" INTEGER NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "trackingConfidence" DOUBLE PRECISION NOT NULL,
    "angleSummary" JSONB NOT NULL,
    "ingestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rep_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_errors" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "repResultId" TEXT,
    "code" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_metrics" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "session_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_reports" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "angleStats" JSONB NOT NULL,
    "commonErrors" JSONB NOT NULL,
    "trackingSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_assessments" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL,
    "painScore" INTEGER,
    "romNotes" TEXT,
    "findings" TEXT NOT NULL,
    "notes" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapist_feedback" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "type" "FeedbackType" NOT NULL DEFAULT 'GENERAL',
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "therapist_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_estimates" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horizonDays" INTEGER NOT NULL,
    "features" JSONB NOT NULL,
    "trend" "TrendDirection" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "modelVersion" TEXT NOT NULL,

    CONSTRAINT "progress_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "patient_profiles_userId_key" ON "patient_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "therapist_profiles_userId_key" ON "therapist_profiles"("userId");

-- CreateIndex
CREATE INDEX "therapist_patients_therapistId_status_idx" ON "therapist_patients"("therapistId", "status");

-- CreateIndex
CREATE INDEX "therapist_patients_patientId_status_idx" ON "therapist_patients"("patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "therapist_patients_therapistId_patientId_key" ON "therapist_patients"("therapistId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_link_invites_codeHash_key" ON "patient_link_invites"("codeHash");

-- CreateIndex
CREATE INDEX "patient_link_invites_patientId_expiresAt_idx" ON "patient_link_invites"("patientId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replacedById_key" ON "refresh_tokens"("replacedById");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_expiresAt_idx" ON "refresh_tokens"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_slug_key" ON "exercises"("slug");

-- CreateIndex
CREATE INDEX "exercises_isActive_category_idx" ON "exercises"("isActive", "category");

-- CreateIndex
CREATE INDEX "exercise_rule_configs_exerciseId_isActive_idx" ON "exercise_rule_configs"("exerciseId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_rule_configs_exerciseId_version_key" ON "exercise_rule_configs"("exerciseId", "version");

-- CreateIndex
CREATE INDEX "rehabilitation_plans_patientId_status_idx" ON "rehabilitation_plans"("patientId", "status");

-- CreateIndex
CREATE INDEX "rehabilitation_plans_therapistId_status_idx" ON "rehabilitation_plans"("therapistId", "status");

-- CreateIndex
CREATE INDEX "exercise_assignments_patientId_status_idx" ON "exercise_assignments"("patientId", "status");

-- CreateIndex
CREATE INDEX "exercise_assignments_therapistId_status_idx" ON "exercise_assignments"("therapistId", "status");

-- CreateIndex
CREATE INDEX "exercise_assignments_planId_idx" ON "exercise_assignments"("planId");

-- CreateIndex
CREATE INDEX "exercise_sessions_patientId_startedAt_idx" ON "exercise_sessions"("patientId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "exercise_sessions_assignmentId_status_idx" ON "exercise_sessions"("assignmentId", "status");

-- CreateIndex
CREATE INDEX "exercise_sessions_status_startedAt_idx" ON "exercise_sessions"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rep_results_ingestKey_key" ON "rep_results"("ingestKey");

-- CreateIndex
CREATE INDEX "rep_results_sessionId_repNumber_idx" ON "rep_results"("sessionId", "repNumber");

-- CreateIndex
CREATE UNIQUE INDEX "rep_results_sessionId_repNumber_key" ON "rep_results"("sessionId", "repNumber");

-- CreateIndex
CREATE INDEX "session_errors_sessionId_code_idx" ON "session_errors"("sessionId", "code");

-- CreateIndex
CREATE INDEX "session_errors_code_idx" ON "session_errors"("code");

-- CreateIndex
CREATE UNIQUE INDEX "session_metrics_sessionId_key_key" ON "session_metrics"("sessionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "session_reports_sessionId_key" ON "session_reports"("sessionId");

-- CreateIndex
CREATE INDEX "clinical_assessments_patientId_assessedAt_idx" ON "clinical_assessments"("patientId", "assessedAt" DESC);

-- CreateIndex
CREATE INDEX "clinical_assessments_therapistId_assessedAt_idx" ON "clinical_assessments"("therapistId", "assessedAt" DESC);

-- CreateIndex
CREATE INDEX "therapist_feedback_patientId_createdAt_idx" ON "therapist_feedback"("patientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "therapist_feedback_therapistId_createdAt_idx" ON "therapist_feedback"("therapistId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_read_createdAt_idx" ON "notifications"("userId", "read", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "progress_estimates_patientId_generatedAt_idx" ON "progress_estimates"("patientId", "generatedAt" DESC);

-- AddForeignKey
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_profiles" ADD CONSTRAINT "therapist_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_patients" ADD CONSTRAINT "therapist_patients_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_patients" ADD CONSTRAINT "therapist_patients_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_link_invites" ADD CONSTRAINT "patient_link_invites_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_link_invites" ADD CONSTRAINT "patient_link_invites_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "therapist_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_rule_configs" ADD CONSTRAINT "exercise_rule_configs_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehabilitation_plans" ADD CONSTRAINT "rehabilitation_plans_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehabilitation_plans" ADD CONSTRAINT "rehabilitation_plans_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_assignments" ADD CONSTRAINT "exercise_assignments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "rehabilitation_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_assignments" ADD CONSTRAINT "exercise_assignments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_assignments" ADD CONSTRAINT "exercise_assignments_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_assignments" ADD CONSTRAINT "exercise_assignments_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "exercise_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_sessions" ADD CONSTRAINT "exercise_sessions_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rep_results" ADD CONSTRAINT "rep_results_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exercise_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_errors" ADD CONSTRAINT "session_errors_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exercise_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_errors" ADD CONSTRAINT "session_errors_repResultId_fkey" FOREIGN KEY ("repResultId") REFERENCES "rep_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_metrics" ADD CONSTRAINT "session_metrics_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exercise_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_reports" ADD CONSTRAINT "session_reports_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exercise_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_assessments" ADD CONSTRAINT "clinical_assessments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_assessments" ADD CONSTRAINT "clinical_assessments_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_feedback" ADD CONSTRAINT "therapist_feedback_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "therapist_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_feedback" ADD CONSTRAINT "therapist_feedback_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapist_feedback" ADD CONSTRAINT "therapist_feedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "exercise_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_estimates" ADD CONSTRAINT "progress_estimates_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
