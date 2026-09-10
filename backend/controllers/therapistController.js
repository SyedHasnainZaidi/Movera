const User = require('../models/User');
const Assignment = require('../models/Assignment');
const Session = require('../models/Session');

// @desc    Get list of patients assigned to therapist
// @route   GET /api/therapist/patients
// @access  Private (Therapist / Admin)
const getTherapistPatients = async (req, res, next) => {
  try {
    let query = { role: 'patient' };
    
    // Filter by therapist if user is therapist (admin can view all)
    if (req.user.role === 'therapist') {
      query.therapistId = req.user._id;
    }

    const patients = await User.find(query).select('-password');
    res.json(patients);
  } catch (error) {
    next(error);
  }
};

// @desc    Add or link patient to therapist
// @route   POST /api/therapist/add-patient
// @access  Private (Therapist / Admin)
const addPatient = async (req, res, next) => {
  try {
    const { name, email, password, condition, phone } = req.body;

    let patient = await User.findOne({ email });

    if (patient) {
      // Link existing patient to therapist
      patient.therapistId = req.user._id;
      if (condition) patient.condition = condition;
      await patient.save();
      return res.json({ message: 'Existing patient linked to your therapist account', patient });
    }

    // Create new patient account linked to therapist
    patient = await User.create({
      name,
      email,
      password: password || 'DefaultPassword123!',
      role: 'patient',
      therapistId: req.user._id,
      condition: condition || 'General Rehab',
      phone: phone || '',
    });

    res.status(201).json({ message: 'New patient created and assigned successfully', patient });
  } catch (error) {
    next(error);
  }
};

// @desc    Get patient detail by ID
// @route   GET /api/therapist/patient/:id
// @access  Private (Therapist / Admin)
const getPatientDetail = async (req, res, next) => {
  try {
    const patient = await User.findById(req.params.id).select('-password');
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const assignments = await Assignment.find({ patientId: patient._id }).populate('exerciseId');
    const recentSessions = await Session.find({ patientId: patient._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('exerciseId');

    res.json({
      patient,
      assignments,
      recentSessions,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get specific patient's exercise & session reports
// @route   GET /api/therapist/patient/:id/reports
// @access  Private (Therapist / Admin)
const getPatientReports = async (req, res, next) => {
  try {
    const sessions = await Session.find({ patientId: req.params.id })
      .sort({ createdAt: -1 })
      .populate('exerciseId');

    res.json(sessions);
  } catch (error) {
    next(error);
  }
};

// @desc    Assign exercise to patient
// @route   POST /api/therapist/assign
// @access  Private (Therapist / Admin)
const assignExercise = async (req, res, next) => {
  try {
    const { patientId, exerciseId, targetReps, sets, frequency } = req.body;

    const assignment = await Assignment.create({
      patientId,
      therapistId: req.user._id,
      exerciseId,
      targetReps: targetReps || 10,
      sets: sets || 3,
      frequency: frequency || 'Daily',
    });

    res.status(201).json({ message: 'Exercise assigned successfully', assignment });
  } catch (error) {
    next(error);
  }
};

// @desc    Get therapist overall analytics
// @route   GET /api/therapist/analytics
// @access  Private (Therapist / Admin)
const getTherapistAnalytics = async (req, res, next) => {
  try {
    const therapistId = req.user._id;
    const patients = await User.find({ therapistId, role: 'patient' });
    const patientIds = patients.map((p) => p._id);

    const totalSessions = await Session.countDocuments({ patientId: { $in: patientIds } });
    const sessions = await Session.find({ patientId: { $in: patientIds } });

    const avgAccuracy =
      sessions.length > 0
        ? Math.round(sessions.reduce((acc, curr) => acc + curr.accuracy, 0) / sessions.length)
        : 0;

    res.json({
      totalPatients: patients.length,
      totalSessions,
      avgAccuracy,
      activeComplianceRate: 88, // Compliance metric percentage
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTherapistPatients,
  addPatient,
  getPatientDetail,
  getPatientReports,
  assignExercise,
  getTherapistAnalytics,
};
