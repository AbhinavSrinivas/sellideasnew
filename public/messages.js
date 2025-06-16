// Global variables
let currentUser = null;
let currentConversation = null;
let currentIdea = null;
let socket = null;
let isTyping = false;
let typingTimeout = null;

// DOM Elements
const conversationsList = document.getElementById('conversations');
const messagesContainer = document.getElementById('messages');
const messageForm = document.getElementById('sendMessageForm');
const messageInput = document.getElementById('messageContent');
const conversationTitle = document.getElementById('conversation-title');
const ideaTitle = document.getElementById('idea-title');
const messageInputContainer = document.querySelector('.message-input');
const logoutBtn = document.getElementById('logoutBtn');

// Check authentication on page load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    if (messageForm) {
        messageForm.addEventListener('submit', sendMessage);
        // Add typing indicator
        messageInput.addEventListener('input', handleTyping);
    }
});

// Initialize WebSocket connection
function initSocket() {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    // Connect to WebSocket server
    socket = io({
        auth: { token },
        transports: ['websocket'],
        upgrade: false
    });
    
    // Connection established
    socket.on('connect', () => {
        console.log('Connected to WebSocket server');
    });
    
    // Handle new message
    socket.on('new-message', (message) => {
        // Only add if it's for the current conversation
        if (currentConversation === message.conversationId) {
            appendMessage(message);
            // Mark as read if it's the current user's conversation
            markMessagesAsRead(currentConversation);
        }
        // Update conversations list
        updateConversationInList(message);
    });
    
    // Handle read receipts
    socket.on('mark-messages-read', ({ conversationId }) => {
        if (currentConversation === conversationId) {
            document.querySelectorAll('.message.received').forEach(msg => {
                msg.classList.add('read');
            });
        }
    });
    
    // Handle typing indicator
    socket.on('user-typing', ({ userId, isTyping }) => {
        if (currentConversation && currentConversation.includes(userId)) {
            const typingIndicator = document.getElementById('typing-indicator');
            if (typingIndicator) {
                typingIndicator.style.display = isTyping ? 'block' : 'none';
            }
        }
    });
    
    // Handle connection errors
    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        showMessage('Connection error. Trying to reconnect...', 'error');
    });
    
    // Handle reconnection
    socket.on('reconnect', () => {
        console.log('Reconnected to WebSocket server');
        showMessage('Connection restored', 'success');
    });
}

// Handle typing indicator
function handleTyping() {
    if (!socket || !currentConversation || !currentUser) return;
    
    // Clear previous timeout
    if (typingTimeout) clearTimeout(typingTimeout);
    
    // User is typing
    if (!isTyping) {
        isTyping = true;
        const recipientId = getOtherUserIdFromConversation(currentConversation);
        if (recipientId) {
            socket.emit('typing', { recipientId, isTyping: true });
        }
    }
    
    // Set timeout to stop typing indicator after 2 seconds of inactivity
    typingTimeout = setTimeout(() => {
        isTyping = false;
        const recipientId = getOtherUserIdFromConversation(currentConversation);
        if (recipientId) {
            socket.emit('typing', { recipientId, isTyping: false });
        }
    }, 2000);
}

// Get other user ID from conversation ID
function getOtherUserIdFromConversation(conversationId) {
    if (!conversationId || !currentUser) return null;
    const parts = conversationId.split('-');
    return parts[0] === currentUser.id ? parts[1] : parts[0];
}

// Handle page visibility changes
function handleVisibilityChange() {
    isPageVisible = !document.hidden;
    if (isPageVisible) {
        // Page became visible, restart polling
        startPolling();
    } else {
        // Page is hidden, stop polling
        stopPolling();
    }
}

// Start polling for new messages
function startPolling() {
    // Clear any existing interval
    stopPolling();
    // Set up new polling interval (30 seconds)
    pollingInterval = setInterval(loadConversations, 30000);
}

// Stop polling
function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (socket) {
        socket.disconnect();
    }
});

// Check if user is authenticated
async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }
    
    try {
        // Verify token and get current user
        const response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Not authenticated');
        }
        
        const user = await response.json();
        currentUser = user;
        
        // Load conversations
        loadConversations();
        
        // Initialize WebSocket connection
        initSocket();
        
    } catch (error) {
        console.error('Authentication error:', error);
        localStorage.removeItem('token');
        window.location.href = 'index.html';
    }
}

// Track last loaded conversations to prevent unnecessary re-renders
let lastConversations = [];

// Load user's conversations
async function loadConversations() {
    if (!isPageVisible) return; // Don't load if page is not visible
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/messages/conversations?t=' + Date.now(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load conversations');
        }
        
        const conversations = await response.json();
        
        // Only update if conversations have changed
        if (JSON.stringify(conversations) !== JSON.stringify(lastConversations)) {
            lastConversations = conversations;
            renderConversations(conversations);
            
            // If we have a current conversation, refresh its messages
            if (currentConversation) {
                loadMessages(currentConversation);
            }
        }
        
    } catch (error) {
        console.error('Error loading conversations:', error);
        // Don't show error if it's just a network error during polling
        if (!error.message.includes('Failed to fetch')) {
            showMessage('Error loading conversations', 'error');
        }
    }
}

// Render conversations list
function renderConversations(conversations) {
    if (conversations.length === 0) {
        conversationsList.innerHTML = '<p class="text-muted">No conversations yet</p>';
        return;
    }
    
    conversationsList.innerHTML = conversations.map(conv => {
        const lastMessageDate = new Date(conv.lastMessage.createdAt).toLocaleString();
        const isUnread = !conv.lastMessage.isRead && 
                        conv.lastMessage.sender._id !== currentUser._id;
        
        return `
            <div class="conversation-item ${isUnread ? 'unread' : ''} ${currentConversation === conv._id ? 'active' : ''}" 
                 onclick="selectConversation('${conv._id}', '${conv.otherUser._id}', '${conv.idea._id}')">
                <div class="conversation-header">
                    <span class="conversation-user">${conv.otherUser.username}</span>
                    <span class="conversation-date">${lastMessageDate}</span>
                </div>
                <p class="conversation-preview">
                    ${conv.lastMessage.sender._id === currentUser._id ? 'You: ' : ''}
                    ${conv.lastMessage.content.substring(0, 50)}${conv.lastMessage.content.length > 50 ? '...' : ''}
                </p>
                <p class="conversation-idea">Idea: ${conv.idea.title}</p>
            </div>
        `;
    }).join('');
}

// Select a conversation
async function selectConversation(conversationId, otherUserId, ideaId) {
    currentConversation = conversationId;
    currentIdea = ideaId;
    
    // Update UI
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-conversation-id') === conversationId) {
            item.classList.add('active');
        }
    });
    
    // Show message input
    messageInputContainer.style.display = 'block';
    
    // Load messages for this conversation
    await loadMessages(conversationId);
    
    // Mark messages as read
    await markMessagesAsRead(conversationId);
}

// Track last loaded messages to prevent unnecessary re-renders
let lastMessages = [];

// Load messages for a conversation
async function loadMessages(conversationId) {
    if (!isPageVisible) return; // Don't load if page is not visible
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/messages/conversation/${currentIdea}/${conversationId}?t=${Date.now()}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load messages');
        }
        
        const messages = await response.json();
        
        // Only update if messages have changed
        if (JSON.stringify(messages) !== JSON.stringify(lastMessages)) {
            lastMessages = messages;
            renderMessages(messages);
        }
        
    } catch (error) {
        console.error('Error loading messages:', error);
        // Don't show error if it's just a network error during polling
        if (!error.message.includes('Failed to fetch')) {
            showMessage('Error loading messages', 'error');
        }
    }
}

// Render messages
function renderMessages(messages) {
    if (messages.length === 0) {
        messagesContainer.innerHTML = '<p class="text-muted">No messages yet. Start the conversation!</p>';
        return;
    }
    
    messagesContainer.innerHTML = messages.map(msg => {
        const isCurrentUser = msg.sender._id === currentUser._id;
        const messageDate = new Date(msg.createdAt).toLocaleString();
        
        return `
            <div class="message ${isCurrentUser ? 'sent' : 'received'}">
                <div class="message-content">
                    ${!isCurrentUser ? `<div class="message-sender">${msg.sender.username}</div>` : ''}
                    <div class="message-text">${msg.content}</div>
                    <div class="message-time">${messageDate}</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Send a new message
async function sendMessage(e) {
    e.preventDefault();
    
    const content = messageInput.value.trim();
    if (!content || !currentConversation || !socket) return;
    
    const recipientId = document.querySelector('.conversation-item.active')?.getAttribute('data-other-user-id');
    if (!recipientId) return;
    
    try {
        // Emit message via WebSocket
        socket.emit('send-message', {
            recipientId,
            content,
            ideaId: currentIdea
        });
        
        // Clear input
        messageInput.value = '';
        
        // Stop typing indicator
        if (typingTimeout) clearTimeout(typingTimeout);
        isTyping = false;
        
    } catch (error) {
        console.error('Error sending message:', error);
        showMessage('Error sending message', 'error');
    }
}

// Append a single message to the UI
function appendMessage(message) {
    const messagesContainer = document.getElementById('messages');
    const isCurrentUser = message.sender._id === currentUser.id;
    const messageDate = new Date(message.createdAt).toLocaleString();
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isCurrentUser ? 'sent' : 'received'}`;
    messageElement.dataset.id = message._id;
    messageElement.innerHTML = `
        <div class="message-content">
            ${!isCurrentUser ? `<div class="message-sender">${message.sender.username}</div>` : ''}
            <div class="message-text">${message.content}</div>
            <div class="message-time">${messageDate}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Update conversation in the conversations list
function updateConversationInList(message) {
    const conversationItem = document.querySelector(`.conversation-item[data-conversation-id="${message.conversationId}"]`);
    if (conversationItem) {
        // Update last message preview
        const preview = conversationItem.querySelector('.conversation-preview');
        if (preview) {
            const isCurrentUser = message.sender._id === currentUser.id;
            preview.textContent = (isCurrentUser ? 'You: ' : '') + 
                                (message.content.length > 30 ? message.content.substring(0, 30) + '...' : message.content);
        }
        
        // Update timestamp
        const timeElement = conversationItem.querySelector('.conversation-time');
        if (timeElement) {
            timeElement.textContent = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        // Move to top if not active
        if (currentConversation !== message.conversationId) {
            conversationItem.classList.add('unread');
            const conversationsList = document.getElementById('conversations');
            conversationsList.insertBefore(conversationItem, conversationsList.firstChild);
        }
    } else {
        // If conversation doesn't exist in the list, reload conversations
        loadConversations();
    }
}

// Mark messages as read
async function markMessagesAsRead(conversationId) {
    try {
        const token = localStorage.getItem('token');
        await fetch(`/api/messages/read/${conversationId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    } catch (error) {
        console.error('Error marking messages as read:', error);
    }
}

// Show message to user
function showMessage(message, type = 'success') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message-${type}`;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    // Remove message after 3 seconds
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

// Handle logout
function handleLogout() {
    localStorage.removeItem('token');
    window.location.href = 'index.html';
}

// Start a new conversation
async function startNewConversation(ideaId, recipientId) {
    currentIdea = ideaId;
    
    try {
        const token = localStorage.getItem('token');
        
        // Create a new conversation
        const response = await fetch('/api/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                recipientId,
                content: 'Hello, I\'m interested in your idea!',
                ideaId
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to start conversation');
        }
        
        // Redirect to messages page
        window.location.href = 'messages.html';
        
    } catch (error) {
        console.error('Error starting conversation:', error);
        showMessage('Error starting conversation', 'error');
    }
}

// Make startNewConversation globally available
window.startNewConversation = startNewConversation;
