const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    exerciseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exercise',
      required: false,
    },
    repsDone: {
      type: Number,
      required: true,
      default: 0,
    },
    accuracy: {
      type: Number,
      required: true,
      default: 0,
    },
    errors: [
      {
        type: String,
      },
    ],
    durationSeconds: {
      type: Number,
      default: 120,
    },
  },
  {
    timestamps: true,
    suppressReservedKeysWarning: true,
  }
);

const Session = mongoose.model('Session', sessionSchema);
module.exports = Session;
