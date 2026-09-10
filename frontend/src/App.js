import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import Navbar from './components/common/Navbar';

// =======================
// Auth Pages
// =======================
import Landing from './pages/auth/Landing';
import Login from './pages/auth/Login';
import Signup from './pages/auth/Signup';
import ForgotPassword from './pages/auth/ForgotPassword';
import NotFound from './pages/auth/NotFound';

// =======================
// Patient Pages
// =======================
import PatientDashboard from './pages/patient/PatientDashboard';
import ExerciseSession from './pages/patient/ExerciseSession';
import ExercisePlan from './pages/patient/ExercisePlan';
import SessionHistory from './pages/patient/SessionHistory';
import ProgressReports from './pages/patient/ProgressReports';
import PatientMessages from './pages/patient/PatientMessages';
import PatientProfile from './pages/patient/PatientProfile';
import PatientNotifications from './pages/patient/PatientNotifications';

// =======================
// Therapist Pages
// =======================
import TherapistDashboard from './pages/therapist/TherapistDashboard';
import PatientList from './pages/therapist/PatientList';
import AddPatient from './pages/therapist/AddPatient';
import PatientDetail from './pages/therapist/PatientDetail';
import ExerciseLibrary from './pages/therapist/ExerciseLibrary';
import AssignExercise from './pages/therapist/AssignExercise';
import TherapistMessages from './pages/therapist/TherapistMessages';
import TherapistAnalytics from './pages/therapist/TherapistAnalytics';
import TherapistProfile from './pages/therapist/TherapistProfile';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>

        <Navbar />

        <Routes>

          {/* =======================
              PUBLIC ROUTES
          ======================= */}

          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            path="/forgot-password"
            element={<ForgotPassword />}
          />

          {/* =======================
              PATIENT ROUTES
          ======================= */}

          <Route
            path="/patient/dashboard"
            element={
              <ProtectedRoute role="patient">
                <PatientDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/patient/session/:exerciseId"
            element={
              <ProtectedRoute role="patient">
                <ExerciseSession />
              </ProtectedRoute>
            }
          />

          <Route
            path="/patient/plan"
            element={
              <ProtectedRoute role="patient">
                <ExercisePlan />
              </ProtectedRoute>
            }
          />

          <Route
            path="/patient/history"
            element={
              <ProtectedRoute role="patient">
                <SessionHistory />
              </ProtectedRoute>
            }
          />

          <Route
            path="/patient/progress"
            element={
              <ProtectedRoute role="patient">
                <ProgressReports />
              </ProtectedRoute>
            }
          />

          <Route
            path="/patient/messages"
            element={
              <ProtectedRoute role="patient">
                <PatientMessages />
              </ProtectedRoute>
            }
          />

          <Route path="/patient/notifications" 
          element={ 
              <ProtectedRoute role="patient">
                 <PatientNotifications />
               </ProtectedRoute> 
              } 
          />

          <Route
            path="/patient/profile"
            element={
              <ProtectedRoute role="patient">
                <PatientProfile />
              </ProtectedRoute>
            }
          />

          {/* =======================
              THERAPIST ROUTES
          ======================= */}

          <Route
            path="/therapist/dashboard"
            element={
              <ProtectedRoute role="therapist">
                <TherapistDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/therapist/patients"
            element={
              <ProtectedRoute role="therapist">
                <PatientList />
              </ProtectedRoute>
            }
          />

          <Route
            path="/therapist/add-patient"
            element={
              <ProtectedRoute role="therapist">
                <AddPatient />
              </ProtectedRoute>
            }
          />


          <Route
            path="/therapist/patient/:id"
            element={
              <ProtectedRoute role="therapist">
                <PatientDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="/therapist/exercises"
            element={
              <ProtectedRoute role="therapist">
                <ExerciseLibrary />
              </ProtectedRoute>
            }
          />

          <Route
            path="/therapist/assign/:patientId"
            element={
              <ProtectedRoute role="therapist">
                <AssignExercise />
              </ProtectedRoute>
            }
          />

          <Route
            path="/therapist/analytics"
            element={
              <ProtectedRoute role="therapist">
                <TherapistAnalytics />
              </ProtectedRoute>
            }
          />

          <Route
            path="/therapist/messages"
            element={
              <ProtectedRoute role="therapist">
                <TherapistMessages />
              </ProtectedRoute>
            }
          />

          <Route
            path="/therapist/profile"
            element={
              <ProtectedRoute role="therapist">
                <TherapistProfile />
              </ProtectedRoute>
            }
          />

          {/* =======================
              404
          ======================= */}

          <Route path="*" element={<NotFound />} />

        </Routes>

      </BrowserRouter>
    </AuthProvider>
  );
}