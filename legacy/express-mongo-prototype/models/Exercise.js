const mongoose = require('mongoose');

const exerciseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Exercise name is required'],
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      default: 'Lower Body',
    },
    description: {
      type: String,
      default: '',
    },
    targetJoints: [
      {
        type: String,
      },
    ],
    targetAngleMin: {
      type: Number,
      default: 60,
    },
    targetAngleMax: {
      type: Number,
      default: 90,
    },
    difficulty: {
      type: String,
      enum: ['Easy', 'Medium', 'Hard'],
      default: 'Medium',
    },
    instructions: {
      type: String,
      default: 'Follow the pose guide on screen.',
    },
    demoVideoUrl: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const Exercise = mongoose.model('Exercise', exerciseSchema);
module.exports = Exercise;
