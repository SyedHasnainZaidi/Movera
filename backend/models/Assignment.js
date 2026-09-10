const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    therapistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    exerciseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exercise',
      required: true,
    },
    targetReps: {
      type: Number,
      default: 10,
    },
    sets: {
      type: Number,
      default: 3,
    },
    frequency: {
      type: String,
      default: 'Daily',
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['Active', 'Completed', 'Paused'],
      default: 'Active',
    },
  },
  {
    timestamps: true,
  }
);

const Assignment = mongoose.model('Assignment', assignmentSchema);
module.exports = Assignment;
