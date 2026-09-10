const express = require('express');
const router = express.Router();
const {
  getExercises,
  getExerciseById,
  createExercise,
  updateExercise,
  deleteExercise,
} = require('../controllers/exerciseController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');

router
  .route('/')
  .get(protect, getExercises)
  .post(protect, authorize('therapist', 'admin'), createExercise);

router
  .route('/:id')
  .get(protect, getExerciseById)
  .put(protect, authorize('therapist', 'admin'), updateExercise)
  .delete(protect, authorize('therapist', 'admin'), deleteExercise);

module.exports = router;
