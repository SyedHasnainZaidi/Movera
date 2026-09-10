const Exercise = require('../models/Exercise');

// @desc    Get all exercises in catalog
// @route   GET /api/exercises
// @access  Private
const getExercises = async (req, res, next) => {
  try {
    const exercises = await Exercise.find({});
    res.json(exercises);
  } catch (error) {
    next(error);
  }
};

// @desc    Get exercise by ID
// @route   GET /api/exercises/:id
// @access  Private
const getExerciseById = async (req, res, next) => {
  try {
    const exercise = await Exercise.findById(req.params.id);
    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found' });
    }
    res.json(exercise);
  } catch (error) {
    next(error);
  }
};

// @desc    Create new exercise in catalog
// @route   POST /api/exercises
// @access  Private (Therapist / Admin)
const createExercise = async (req, res, next) => {
  try {
    const { name, category, description, targetJoints, targetAngleMin, targetAngleMax, difficulty, instructions } = req.body;

    const exercise = await Exercise.create({
      name,
      category,
      description,
      targetJoints,
      targetAngleMin,
      targetAngleMax,
      difficulty,
      instructions,
    });

    res.status(201).json(exercise);
  } catch (error) {
    next(error);
  }
};

// @desc    Update exercise
// @route   PUT /api/exercises/:id
// @access  Private (Therapist / Admin)
const updateExercise = async (req, res, next) => {
  try {
    const exercise = await Exercise.findById(req.params.id);
    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    Object.assign(exercise, req.body);
    const updated = await exercise.save();
    res.json(updated);
  } catch (error) {
    next(error);
  }
};

// @desc    Delete exercise
// @route   DELETE /api/exercises/:id
// @access  Private (Therapist / Admin)
const deleteExercise = async (req, res, next) => {
  try {
    const exercise = await Exercise.findById(req.params.id);
    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found' });
    }

    await exercise.deleteOne();
    res.json({ message: 'Exercise removed from catalog' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getExercises,
  getExerciseById,
  createExercise,
  updateExercise,
  deleteExercise,
};
