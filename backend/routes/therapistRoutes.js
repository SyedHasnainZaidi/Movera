const express = require('express');
const router = express.Router();
const {
  getTherapistPatients,
  addPatient,
  getPatientDetail,
  getPatientReports,
  assignExercise,
  getTherapistAnalytics,
} = require('../controllers/therapistController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.get('/patients', protect, authorize('therapist', 'admin'), getTherapistPatients);
router.post('/add-patient', protect, authorize('therapist', 'admin'), addPatient);
router.get('/patient/:id', protect, authorize('therapist', 'admin'), getPatientDetail);
router.get('/patient/:id/reports', protect, authorize('therapist', 'admin'), getPatientReports);
router.post('/assign', protect, authorize('therapist', 'admin'), assignExercise);
router.get('/analytics', protect, authorize('therapist', 'admin'), getTherapistAnalytics);

module.exports = router;
