import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppLayout, AuthLayout } from '../layouts/AppLayout';
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { ResetPasswordPage } from '../pages/auth/ResetPasswordPage';
import { VerifyEmailPage } from '../pages/auth/VerifyEmailPage';
import { LiveSessionPage } from '../pages/patient/LiveSessionPage';
import { MyTherapistPage } from '../pages/patient/MyTherapistPage';
import { PatientDashboardPage } from '../pages/patient/PatientDashboard';
import { ProgressPage } from '../pages/patient/ProgressPage';
import { SessionReportPage } from '../pages/patient/SessionReportPage';
import {
  ExerciseLibraryPage,
  MyExercisesPage,
  NotFoundPage,
  NotificationsPage,
  SessionHistoryPage,
} from '../pages/shared/MiscPages';
import { PatientDetailPage } from '../pages/therapist/PatientDetailPage';
import { PatientsPage } from '../pages/therapist/PatientsPage';
import { TherapistDashboardPage } from '../pages/therapist/TherapistDashboard';
import { useAuthStore } from '../stores/authStore';
import { ProtectedRoute, RoleRoute, RootRedirect } from './guards';

/** Therapist view of a patient's progress - same component, explicit id. */
function TherapistPatientProgress() {
  const { patientId } = useParams();
  return <ProgressPage patientId={patientId} />;
}

/** Sends an already-signed-in user away from the auth screens. */
function GuestOnly({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const initialising = useAuthStore((state) => state.initialising);
  if (initialising) return null;
  if (user) {
    return (
      <Navigate
        to={user.role === 'THERAPIST' ? '/therapist' : '/patient'}
        replace
      />
    );
  }
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        element={
          <GuestOnly>
            <AuthLayout />
          </GuestOnly>
        }
      >
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/*
        Deliberately NOT behind GuestOnly.

        These three are reached from a link in an email, and that link may well
        be opened in a browser where someone is already signed in - a patient
        resetting a password on a shared machine, or a therapist clicking a
        verification link for a second account. Bouncing them to a dashboard
        would make the link appear broken.
      */}
      <Route element={<AuthLayout />}>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      {/*
        The live session is intentionally OUTSIDE AppLayout: the camera view
        needs the full viewport, and a navigation bar during an exercise invites
        the patient to walk away mid-repetition.
      */}
      <Route
        path="/patient/session/:assignmentId"
        element={
          <RoleRoute role="PATIENT">
            <LiveSessionPage />
          </RoleRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<RootRedirect />} />

        {/* --- patient --- */}
        <Route
          path="/patient"
          element={
            <RoleRoute role="PATIENT">
              <PatientDashboardPage />
            </RoleRoute>
          }
        />
        <Route
          path="/patient/exercises"
          element={
            <RoleRoute role="PATIENT">
              <MyExercisesPage />
            </RoleRoute>
          }
        />
        <Route
          path="/patient/sessions"
          element={
            <RoleRoute role="PATIENT">
              <SessionHistoryPage />
            </RoleRoute>
          }
        />
        <Route
          path="/patient/sessions/:sessionId/report"
          element={
            <RoleRoute role="PATIENT">
              <SessionReportPage />
            </RoleRoute>
          }
        />
        <Route
          path="/patient/progress"
          element={
            <RoleRoute role="PATIENT">
              <ProgressPage />
            </RoleRoute>
          }
        />
        <Route
          path="/patient/therapist"
          element={
            <RoleRoute role="PATIENT">
              <MyTherapistPage />
            </RoleRoute>
          }
        />
        <Route
          path="/patient/notifications"
          element={
            <RoleRoute role="PATIENT">
              <NotificationsPage />
            </RoleRoute>
          }
        />

        {/* --- therapist --- */}
        <Route
          path="/therapist"
          element={
            <RoleRoute role="THERAPIST">
              <TherapistDashboardPage />
            </RoleRoute>
          }
        />
        <Route
          path="/therapist/patients"
          element={
            <RoleRoute role="THERAPIST">
              <PatientsPage />
            </RoleRoute>
          }
        />
        <Route
          path="/therapist/patients/:patientId"
          element={
            <RoleRoute role="THERAPIST">
              <PatientDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="/therapist/patients/:patientId/progress"
          element={
            <RoleRoute role="THERAPIST">
              <TherapistPatientProgress />
            </RoleRoute>
          }
        />
        <Route
          path="/therapist/sessions/:sessionId/report"
          element={
            <RoleRoute role="THERAPIST">
              <SessionReportPage />
            </RoleRoute>
          }
        />
        <Route
          path="/therapist/exercises"
          element={
            <RoleRoute role="THERAPIST">
              <ExerciseLibraryPage />
            </RoleRoute>
          }
        />
        <Route
          path="/therapist/notifications"
          element={
            <RoleRoute role="THERAPIST">
              <NotificationsPage />
            </RoleRoute>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
