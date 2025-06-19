const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const User = require('../models/User');

// Send a message
router.post('/', auth, async (req, res) => {
    try {
        const { recipientId, content, ideaId } = req.body;
        
        // Check if recipient exists
        const recipient = await User.findById(recipientId);
        if (!recipient) {
            return res.status(404).json({ error: 'Recipient not found' });
        }

        // Create a conversation ID that's the same for both users
        const participants = [req.user.id, recipientId].sort();
        const conversationId = `${participants[0]}-${participants[1]}-${ideaId}`;

        const message = new Message({
            conversationId,
            sender: req.user.id,
            recipient: recipientId,
            content,
            idea: ideaId
        });

        await message.save();
        res.status(201).json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Error sending message' });
    }
});

// Get all messages in a conversation
router.get('/conversation/:ideaId/:otherUserId', auth, async (req, res) => {
    try {
        const { ideaId, otherUserId } = req.params;
        
        // Create the same conversation ID as before
        const participants = [req.user.id, otherUserId].sort();
        const conversationId = `${participants[0]}-${participants[1]}-${ideaId}`;

        const messages = await Message.find({
            conversationId,
            $or: [
                { sender: req.user.id, recipient: otherUserId },
                { sender: otherUserId, recipient: req.user.id }
            ]
        })
        .sort('createdAt')
        .populate('sender', 'username')
        .populate('recipient', 'username');

        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Error fetching messages' });
    }
});

// Get all conversations for the current user
router.get('/conversations', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        // Grab all messages for the current user, newest first
        const messages = await Message.find({
            $or: [{ sender: userId }, { recipient: userId }]
        })
            .sort({ createdAt: -1 })
            .populate('sender', 'username')
            .populate('recipient', 'username')
            .populate('idea')
            .lean();

        // Build a map of conversationId -> lastMessage
        const convoMap = new Map();
        for (const msg of messages) {
            if (!convoMap.has(msg.conversationId)) {
                // Determine the other user object
                const otherUser = msg.sender._id.toString() === userId ? msg.recipient : msg.sender;
                convoMap.set(msg.conversationId, {
                    _id: msg.conversationId,
                    lastMessage: msg,
                    idea: msg.idea || null,
                    otherUser: {
                        _id: otherUser._id,
                        username: otherUser.username
                    }
                });
            }
        }

        res.json(Array.from(convoMap.values()));
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Error fetching conversations' });
    }
});

// Mark messages as read
router.patch('/read/:conversationId', auth, async (req, res) => {
    try {
        const { conversationId } = req.params;
        
        await Message.updateMany(
            {
                conversationId,
                recipient: req.user.id,
                isRead: false
            },
            { $set: { isRead: true } }
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ error: 'Error marking messages as read' });
    }
});

module.exports = router;
