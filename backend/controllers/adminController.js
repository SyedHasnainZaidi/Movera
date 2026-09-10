const User = require('../models/User');
const Session = require('../models/Session');
const Exercise = require('../models/Exercise');
const Assignment = require('../models/Assignment');

// @desc    Get all users (Admin panel)
// @route   GET /api/admin/users
// @access  Private (Admin)
const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    next(error);
  }
};

// @desc    Update user role or status (Admin panel)
// @route   PUT /api/admin/users/:id/role
// @access  Private (Admin)
const updateUserRole = async (req, res, next) => {
  try {
    const { role, therapistId } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (role) user.role = role;
    if (therapistId !== undefined) user.therapistId = therapistId;

    const updatedUser = await user.save();
    res.json({ message: 'User role updated successfully', user: updatedUser });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete user account (Admin panel)
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await user.deleteOne();
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Get platform high-level statistics (Admin Panel)
// @route   GET /api/admin/stats
// @access  Private (Admin)
const getAdminStats = async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalPatients = await User.countDocuments({ role: 'patient' });
    const totalTherapists = await User.countDocuments({ role: 'therapist' });
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const totalSessions = await Session.countDocuments();
    const totalExercises = await Exercise.countDocuments();
    const totalAssignments = await Assignment.countDocuments();

    res.json({
      totalUsers,
      totalPatients,
      totalTherapists,
      totalAdmins,
      totalSessions,
      totalExercises,
      totalAssignments,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllUsers,
  updateUserRole,
  deleteUser,
  getAdminStats,
};
