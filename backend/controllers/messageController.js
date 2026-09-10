const Message = require('../models/Message');
const User = require('../models/User');

// @desc    Get messages for logged in user (or between specific patient/therapist)
// @route   GET /api/messages OR GET /api/messages/:recipientId
// @access  Private
const getMessages = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const { recipientId } = req.params;

    let targetId = recipientId;

    // If no explicit recipientId provided, resolve default linked user
    if (!targetId) {
      if (req.user.role === 'patient' && req.user.therapistId) {
        targetId = req.user.therapistId;
      } else {
        // Find most recent chat participant
        const lastMsg = await Message.findOne({
          $or: [{ senderId: currentUserId }, { recipientId: currentUserId }],
        }).sort({ createdAt: -1 });

        if (lastMsg) {
          targetId =
            lastMsg.senderId.toString() === currentUserId.toString()
              ? lastMsg.recipientId
              : lastMsg.senderId;
        }
      }
    }

    if (!targetId) {
      return res.json([]);
    }

    const messages = await Message.find({
      $or: [
        { senderId: currentUserId, recipientId: targetId },
        { senderId: targetId, recipientId: currentUserId },
      ],
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    next(error);
  }
};

// @desc    Send a direct message
// @route   POST /api/messages
// @access  Private
const sendMessage = async (req, res, next) => {
  try {
    const { text, recipientId } = req.body;
    let targetRecipientId = recipientId;

    if (!targetRecipientId) {
      if (req.user.role === 'patient') {
        targetRecipientId = req.user.therapistId;
      }
    }

    if (!targetRecipientId) {
      return res.status(400).json({ message: 'Recipient ID is required' });
    }

    const message = await Message.create({
      senderId: req.user._id,
      recipientId: targetRecipientId,
      text,
    });

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMessages,
  sendMessage,
};
