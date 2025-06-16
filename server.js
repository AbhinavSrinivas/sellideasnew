const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const authRoutes = require('./routes/auth');
const ideaRoutes = require('./routes/ideas');
const messageRoutes = require('./routes/messages');
const Message = require('./models/Message');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // In production, replace with your frontend URL
        methods: ['GET', 'POST']
    }
});

// Socket.IO connection handling
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        next();
    } catch (err) {
        return next(new Error('Authentication error'));
    }
});

// Store active users
const activeUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.userId);
    activeUsers.set(socket.userId, socket.id);
    
    // Notify users when someone comes online
    socket.broadcast.emit('user-online', { userId: socket.userId });
    
    // Handle new message
    socket.on('send-message', async ({ recipientId, content, ideaId }) => {
        try {
            // Create a conversation ID that's the same for both users
            const participants = [socket.userId, recipientId].sort();
            const conversationId = `${participants[0]}-${participants[1]}-${ideaId}`;
            
            const message = new Message({
                conversationId,
                sender: socket.userId,
                recipient: recipientId,
                content,
                idea: ideaId
            });
            
            await message.save();
            
            // Populate sender info
            const populatedMessage = await Message.findById(message._id)
                .populate('sender', 'username')
                .populate('recipient', 'username');
            
            // Emit to sender
            socket.emit('new-message', populatedMessage);
            
            // Emit to recipient if online
            if (activeUsers.has(recipientId)) {
                io.to(activeUsers.get(recipientId)).emit('new-message', populatedMessage);
                
                // Mark as read if recipient is the current viewer
                io.to(activeUsers.get(recipientId)).emit('mark-messages-read', {
                    conversationId,
                    senderId: socket.userId
                });
            }
            
        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });
    
    // Handle typing indicator
    socket.on('typing', ({ recipientId, isTyping }) => {
        if (activeUsers.has(recipientId)) {
            io.to(activeUsers.get(recipientId)).emit('user-typing', {
                userId: socket.userId,
                isTyping
            });
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.userId);
        activeUsers.delete(socket.userId);
        // Notify users when someone goes offline
        socket.broadcast.emit('user-offline', { userId: socket.userId });
    });
});

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://your-username:your-password@cluster0.mongodb.net/sell-ideas?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
  serverApi: {
    version: '1',
    strict: true,
    deprecationErrors: true
  }
})
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit process if connection fails
  });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/ideas', ideaRoutes);
app.use('/api/messages', messageRoutes);

// Serve static files
app.use(express.static('public'));

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
});
