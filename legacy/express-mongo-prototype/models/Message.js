const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: [true, 'Message text cannot be empty'],
      trim: true,
    },
    readStatus: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;
