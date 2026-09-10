const Session = require('../models/Session');
const Assignment = require('../models/Assignment');
const User = require('../models/User');

// @desc    Get patient dashboard summary
// @route   GET /api/patient/dashboard
// @access  Private (Patient)
const getPatientDashboard = async (req, res, next) => {
  try {
    const patientId = req.user._id;

    // Fetch assigned exercises
    const assignments = await Assignment.find({ patientId, status: 'Active' })
      .populate('exerciseId')
      .populate('therapistId', 'name email phone');

    // Fetch recent sessions
    const recentSessions = await Session.find({ patientId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('exerciseId', 'name category');

    // Calculate total sessions & average accuracy
    const allSessions = await Session.find({ patientId });
    const totalSessions = allSessions.length;
    const avgAccuracy =
      totalSessions > 0
        ? Math.round(allSessions.reduce((acc, curr) => acc + curr.accuracy, 0) / totalSessions)
        : 0;

    res.json({
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        condition: req.user.condition,
      },
      stats: {
        totalSessions,
        avgAccuracy,
        activePlansCount: assignments.length,
      },
      assignedExercises: assignments,
      recentSessions,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get patient assigned exercise plan
// @route   GET /api/patient/plan
// @access  Private (Patient)
const getPatientPlan = async (req, res, next) => {
  try {
    const assignments = await Assignment.find({ patientId: req.user._id })
      .populate('exerciseId')
      .populate('therapistId', 'name email');

    res.json(assignments);
  } catch (error) {
    next(error);
  }
};

// @desc    Get patient session history
// @route   GET /api/patient/history
// @access  Private (Patient)
const getSessionHistory = async (req, res, next) => {
  try {
    const sessions = await Session.find({ patientId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('exerciseId', 'name category');

    res.json(sessions);
  } catch (error) {
    next(error);
  }
};

// @desc    Get patient progress report metrics
// @route   GET /api/patient/progress
// @access  Private (Patient)
const getProgressReports = async (req, res, next) => {
  try {
    const sessions = await Session.find({ patientId: req.user._id })
      .sort({ createdAt: 1 })
      .populate('exerciseId', 'name');

    const totalReps = sessions.reduce((sum, s) => sum + (s.repsDone || 0), 0);
    const avgAccuracy =
      sessions.length > 0
        ? Math.round(sessions.reduce((sum, s) => sum + (s.accuracy || 0), 0) / sessions.length)
        : 0;

    // Build timeline for chart visualization
    const progressTimeline = sessions.map((s) => ({
      date: s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'N/A',
      reps: s.repsDone,
      accuracy: s.accuracy,
      exercise: s.exerciseId ? s.exerciseId.name : 'Squat',
    }));

    res.json({
      summary: {
        totalSessionsCompleted: sessions.length,
        totalReps,
        avgAccuracy,
      },
      timeline: progressTimeline,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Log completed exercise session from real-time webcam pose detection
// @route   POST /api/session
// @access  Private (Patient)
const logSession = async (req, res, next) => {
  try {
    const { exerciseId, repsDone, accuracy, errors, durationSeconds } = req.body;

    const newSession = await Session.create({
      patientId: req.user._id,
      exerciseId: exerciseId || null,
      repsDone: repsDone || 0,
      accuracy: accuracy || 80,
      errors: errors || [],
      durationSeconds: durationSeconds || 120,
    });

    res.status(201).json({
      message: 'Session successfully saved!',
      session: newSession,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPatientDashboard,
  getPatientPlan,
  getSessionHistory,
  getProgressReports,
  logSession,
};
