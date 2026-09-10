const express = require('express');
const router = express.Router();
const {
  getAllUsers,
  updateUserRole,
  deleteUser,
  getAdminStats,
} = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router.get('/users', protect, authorize('admin'), getAllUsers);
router.put('/users/:id/role', protect, authorize('admin'), updateUserRole);
router.delete('/users/:id', protect, authorize('admin'), deleteUser);
router.get('/stats', protect, authorize('admin'), getAdminStats);

module.exports = router;
