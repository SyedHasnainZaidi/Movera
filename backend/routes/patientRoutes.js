const express = require('express');
const router = express.Router();
const {
  getPatientDashboard,
  getPatientPlan,
  getSessionHistory,
  getProgressReports,
  logSession,
} = require('../controllers/patientController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

// Patient Dashboard & Metrics
router.get('/patient/dashboard', protect, authorize('patient', 'admin'), getPatientDashboard);
router.get('/patient/plan', protect, authorize('patient', 'admin'), getPatientPlan);
router.get('/patient/history', protect, authorize('patient', 'admin'), getSessionHistory);
router.get('/patient/progress', protect, authorize('patient', 'admin'), getProgressReports);

// Post Real-time webcam exercise session log
router.post('/session', protect, authorize('patient', 'admin'), logSession);

module.exports = router;
