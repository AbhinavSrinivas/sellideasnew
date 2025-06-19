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
// Serve a blank favicon to prevent 404s in the browser
app.get('/favicon.ico', (req, res) => res.status(204).end());
const server = http.createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8, // 100MB max payload
    serveClient: false, // Don't serve client files
    allowEIO3: true, // Enable compatibility with older clients
    allowRequest: (req, callback) => {
        // Add rate limiting here if needed
        callback(null, true);
    }
});

// Track active users with WeakMap for better garbage collection
const activeUsers = new Map();
const userRooms = new Map();

// Cache for user presence to reduce DB lookups
const presenceCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

// Socket.IO middleware for JWT authentication
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }

    // Check cache first
    const cached = presenceCache.get(token);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        socket.userId = cached.userId;
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        // Update cache
        presenceCache.set(token, {
            userId: decoded.userId,
            timestamp: Date.now()
        });
        next();
    } catch (error) {
        return next(new Error('Authentication error'));
    }
});

// Optimize message handling with batching
const messageQueue = new Map();
const BATCH_INTERVAL = 50; // ms
let isProcessingBatch = false;

async function processMessageBatch() {
    if (isProcessingBatch || messageQueue.size === 0) return;
    
    isProcessingBatch = true;
    const batch = new Map(messageQueue);
    messageQueue.clear();
    
    try {
        const messages = Array.from(batch.values());
        // Save all messages in a single DB operation
        const savedMessages = await Message.insertMany(messages);
        
        // Populate sender data for all messages
        await Message.populate(savedMessages, { path: 'sender', select: 'username' });
        
        // Emit messages to recipients
        for (const message of savedMessages) {
            const recipientSocketId = activeUsers.get(message.recipient.toString())?.socketId;
            const senderSocketId = activeUsers.get(message.sender._id.toString())?.socketId;
            
            // Emit to sender if connected
            if (senderSocketId) {
                io.to(senderSocketId).emit('new-message', message);
            }
            
            // Emit to recipient if connected and not the same as sender
            if (recipientSocketId && recipientSocketId !== senderSocketId) {
                io.to(recipientSocketId).emit('new-message', message);
            }
        }
    } catch (error) {
        console.error('Error processing message batch:', error);
        // Optionally implement retry logic here
    } finally {
        isProcessingBatch = false;
        
        // Process next batch if any
        if (messageQueue.size > 0) {
            setImmediate(processMessageBatch);
        }
    }
}

// Start batch processing interval
setInterval(processMessageBatch, BATCH_INTERVAL);

io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log('Client connected:', userId);
    
    // Add user to active users
    activeUsers.set(userId, {
        socketId: socket.id,
        lastSeen: Date.now()
    });
    
    // Join user to their own room for targeted messages
    socket.join(`user_${userId}`);
    userRooms.set(userId, `user_${userId}`);
    
    // Notify user is online
    socket.broadcast.emit('user-status', { userId, isOnline: true });

    // Handle new message with batching
    socket.on('send-message', async (data) => {
        try {
            const { recipientId, content, ideaId } = data;
            const senderId = userId;
            
            if (!recipientId || !content) {
                throw new Error('Missing required fields');
            }
            
            // Validate content length
            if (content.length > 1000) {
                throw new Error('Message too long');
            }
            
            const conversationId = [...[senderId, recipientId].sort(), ideaId || ''].join('-');
            
            // Add message to batch queue
            messageQueue.set(Date.now(), {
                sender: senderId,
                recipient: recipientId,
                content: content.substring(0, 1000), // Ensure max length
                idea: ideaId || null,
                conversationId,
                createdAt: new Date()
            });
            
            // Process batch if not already processing
            if (!isProcessingBatch) {
                processMessageBatch();
            }
            
        } catch (error) {
            console.error('Error queuing message:', error);
            socket.emit('error', { 
                code: 'MESSAGE_ERROR',
                message: error.message || 'Failed to send message' 
            });
        }
    });

    // Handle typing indicator with debouncing
    const typingTimers = new Map();
    
    socket.on('typing', ({ recipientId, isTyping }) => {
        if (!recipientId) return;
        
        // Clear existing timer if any
        if (typingTimers.has(recipientId)) {
            clearTimeout(typingTimers.get(recipientId));
        }
        
        // Set a new timer to automatically turn off typing indicator after 3s
        if (isTyping) {
            typingTimers.set(recipientId, setTimeout(() => {
                socket.to(`user_${recipientId}`).emit('user-typing', { 
                    userId,
                    isTyping: false 
                });
                typingTimers.delete(recipientId);
            }, 3000));
        }
        
        // Emit typing status
        socket.to(`user_${recipientId}`).emit('user-typing', { 
            userId,
            isTyping 
        });
    });

    // Handle disconnect with cleanup
    socket.on('disconnect', (reason) => {
        console.log(`Client disconnected (${reason}):`, userId);
        
        // Clean up typing timers
        typingTimers.forEach(timer => clearTimeout(timer));
        typingTimers.clear();
        
        // Remove from active users
        activeUsers.delete(userId);
        
        // Leave room
        const room = userRooms.get(userId);
        if (room) {
            socket.leave(room);
            userRooms.delete(userId);
        }
        
        // Notify others user is offline
        socket.broadcast.emit('user-status', { 
            userId, 
            isOnline: false,
            lastSeen: new Date()
        });
    });
    
    // Handle ping/pong for connection health
    socket.conn.on('ping', () => {
        // Update last seen on ping
        const user = activeUsers.get(userId);
        if (user) {
            user.lastSeen = Date.now();
        }
    });
});

// Clean up inactive users periodically
setInterval(() => {
    const now = Date.now();
    const timeout = 300000; // 5 minutes
    
    for (const [userId, data] of activeUsers.entries()) {
        if (now - data.lastSeen > timeout) {
            console.log(`Removing inactive user: ${userId}`);
            activeUsers.delete(userId);
            userRooms.delete(userId);
            
            // Notify others user is offline
            io.emit('user-status', { 
                userId, 
                isOnline: false,
                lastSeen: new Date(data.lastSeen)
            });
        }
    }
}, 60000); // Check every minute

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
