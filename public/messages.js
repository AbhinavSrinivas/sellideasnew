// API base URL (define once globally)
window.API_BASE_URL = window.API_BASE_URL || 'http://localhost:3001';
const API_BASE_URL = window.API_BASE_URL;

// Global variables
let isPageVisible = !document.hidden; // Track page visibility
let currentUser = null;
let currentConversation = null;
let pollingInterval = null;
let currentIdea = null;
let currentOtherUserId = null; // the user on the other side of the conversation
let socket = null;
let isTyping = false;
let typingTimeout = null;
let messageBatch = [];
let batchTimeout = null;
const BATCH_DELAY = 50; // ms between batch updates
let isProcessingBatch = false;

// Diagnostics
let messageEventCount = 0;
let messageEventRate = 0;
let messageCountDisplay = null;
let eventRateDisplay = null;
const MESSAGE_LIMIT = 50;

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
    // Add diagnostics UI
    addDiagnosticsUI();
    checkAuth();
    // Listen for page visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
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
    
    // Handle new message with batching
    socket.on('new-message', (message) => {
        messageEventCount++;
        const recvTime = performance.now();
        //console.log('[PERF] new-message event received', { id: message._id, recvTime });
        // Add to batch
        messageBatch.push({ ...message, _recvTime: recvTime });
        
        // Process batch if not already processing
        if (!isProcessingBatch) {
            processMessageBatch();
        }
    });
    
    // Process messages in batches to reduce re-renders
    function processMessageBatch() {
        if (messageBatch.length === 0) {
            isProcessingBatch = false;
            return;
        }
        
        isProcessingBatch = true;
        const batchStart = performance.now();
        
        // Process all messages in the current batch
        const processedMessages = new Set();
        const currentBatch = [];
        
        // Deduplicate messages (in case of any duplicates)
        while (messageBatch.length > 0) {
            const msg = messageBatch.shift();
            if (!processedMessages.has(msg._id)) {
                processedMessages.add(msg._id);
                currentBatch.push(msg);
            }
        }
        
        // Process each message in the batch
        currentBatch.forEach(message => {
            // Only add if it's for the current conversation
            if (currentConversation === message.conversationId) {
                const beforeRender = performance.now();
                appendMessage(message);
                const afterRender = performance.now();
                if (message._recvTime) {
                    console.log(`[PERF] Message ${message._id} latency:`, {
                        recvToRender: beforeRender - message._recvTime,
                        renderTime: afterRender - beforeRender
                    });
                }
                // Mark as read if it's the current user's conversation
                markMessagesAsRead(currentConversation);
            }
            // Update conversations list
            const beforeUpdate = performance.now();
            updateConversationInList(message);
            const afterUpdate = performance.now();
            if (afterUpdate - beforeUpdate > 10) {
                console.log(`[PERF] updateConversationInList slow for ${message._id}:`, afterUpdate - beforeUpdate, 'ms');
            }
        });
        
        const batchEnd = performance.now();
        if (batchEnd - batchStart > 10) {
            console.log(`[PERF] Batch processing time:`, batchEnd - batchStart, 'ms for', currentBatch.length, 'messages');
        }
        
        // Schedule next batch if needed
        if (messageBatch.length > 0) {
            setTimeout(processMessageBatch, BATCH_DELAY);
        } else {
            isProcessingBatch = false;
        }
    }
    
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
        showMessage('No authentication token found. Redirecting to login...', 'error');
        setTimeout(() => {
            // No redirect. Only show error message.
        }, 3000);
        return;
    }
    
    try {
        // Verify token and get current user
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            showMessage(`Auth failed: ${response.status} ${errorText}. Redirecting to login...`, 'error');
            setTimeout(() => {
                // No redirect. Only show error message.
            }, 3000);
            return;
        }
        
        const user = await response.json();
        currentUser = user;
        if (!currentUser || !currentUser._id) {
            showMessage('Invalid user object received from server. Logging out...', 'error');
            // No redirect. Show error and stop.
            localStorage.removeItem('token');
            return;
        }
        
        // Load conversations
        loadConversations();
        
        // Initialize WebSocket connection
        initSocket();
        
    } catch (error) {
        showMessage(`Authentication error: ${error.message}. Redirecting to login...`, 'error');
        setTimeout(() => {
            // No redirect. Only show error message.
        }, 3000);
    }
}

// Track last loaded conversations to prevent unnecessary re-renders
let lastConversations = [];

// Load user's conversations
async function loadConversations() {
    if (!currentUser || !currentUser._id) {
        showMessage('Cannot load conversations: user is null or missing _id. Logging out...', 'error');
        // No redirect. Show error and stop.
        localStorage.removeItem('token');
    }
    if (!isPageVisible) return; // Don't load if page is not visible
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}/api/messages/conversations?t=${Date.now()}`, {
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
            if (currentConversation && currentOtherUserId) {
                loadMessages(currentOtherUserId);
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
                 data-conversation-id="${conv._id}" data-other-user-id="${conv.otherUser._id}"
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
    currentOtherUserId = otherUserId;
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
    
    // Load messages with other user
    await loadMessages(otherUserId);
    
    // Mark messages as read
    await markMessagesAsRead(conversationId);
}

// Track last loaded messages to prevent unnecessary re-renders
let lastMessages = [];

// Load messages for a conversation
async function loadMessages(otherUserId) {
    if (!isPageVisible) return; // Don't load if page is not visible
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}/api/messages/conversation/${currentIdea}/${otherUserId}?t=${Date.now()}`, {
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

// Cache for message elements to reduce DOM queries
const messageCache = new Map();
let lastScrollPosition = 0;
let shouldAutoScroll = true;

// Append a single message to the UI with optimizations
function appendMessage(message) {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    
    // Limit to MESSAGE_LIMIT messages in DOM
    while (messagesContainer.children.length >= MESSAGE_LIMIT) {
        const rm = messagesContainer.firstChild;
        if (rm && rm.classList && rm.classList.contains('message')) {
            messagesContainer.removeChild(rm);
        } else {
            break;
        }
    }

    const isCurrentUser = message.sender._id === currentUser.id;
    const messageDate = new Date(message.createdAt).toLocaleString();
    
    // Check if message already exists in the DOM
    if (messageCache.has(message._id)) {
        updateMessageCountDisplay();
        return;
    }
    
    // Create document fragment for better performance
    const fragment = document.createDocumentFragment();
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isCurrentUser ? 'sent' : 'received'}`;
    messageElement.dataset.id = message._id;
    
    // Create message content using template literals
    messageElement.innerHTML = `
        <div class="message-content">
            ${!isCurrentUser ? `<div class="message-sender">${escapeHtml(message.sender.username)}</div>` : ''}
            <div class="message-text">${escapeHtml(message.content)}</div>
            <div class="message-time">${escapeHtml(messageDate)}</div>
        </div>
    `;
    
    // Add to fragment
    fragment.appendChild(messageElement);
    
    // Check if we should auto-scroll
    const wasNearBottom = isNearBottom(messagesContainer);
    
    // Add to DOM
    messagesContainer.appendChild(fragment);
    
    // Cache the message
    messageCache.set(message._id, messageElement);
    
    // Auto-scroll if near bottom or if it's the current user's message
    if (wasNearBottom || isCurrentUser) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Limit cache size
    if (messageCache.size > 100) {
        const firstKey = messageCache.keys().next().value;
        messageCache.delete(firstKey);
    }
    
    updateMessageCountDisplay();
}

function updateMessageCountDisplay() {
    if (messageCountDisplay) {
        const messagesContainer = document.getElementById('messages');
        messageCountDisplay.textContent = `Messages in DOM: ${messagesContainer ? messagesContainer.children.length : 0}`;
    }
}

// Simple HTML escaping to prevent XSS
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Check if scroll is near bottom
function isNearBottom(element) {
    if (!element) return true;
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 100;
}

// Add diagnostics UI to the page
function addDiagnosticsUI() {
    let header = document.getElementById('diagnostics-header');
    if (!header) {
        header = document.createElement('div');
        header.id = 'diagnostics-header';
        header.style.position = 'fixed';
        header.style.top = '0';
        header.style.left = '0';
        header.style.right = '0';
        header.style.zIndex = '9999';
        header.style.background = '#222';
        header.style.color = '#0f0';
        header.style.fontSize = '14px';
        header.style.padding = '2px 8px';
        header.style.display = 'flex';
        header.style.gap = '2rem';
        document.body.appendChild(header);
    }
    messageCountDisplay = document.createElement('span');
    eventRateDisplay = document.createElement('span');
    header.appendChild(messageCountDisplay);
    header.appendChild(eventRateDisplay);
    updateMessageCountDisplay();
    updateEventRateDisplay();
    setInterval(updateEventRateDisplay, 1000);
}

function updateEventRateDisplay() {
    eventRateDisplay.textContent = `new-message/sec: ${messageEventRate}`;
    messageEventRate = messageEventCount;
    messageEventCount = 0;
}


// Cache for conversation items
const conversationCache = new Map();

// Update conversation in the conversations list with optimizations
function updateConversationInList(message) {
    if (!message || !message.conversationId) return;
    
    const conversationId = message.conversationId;
    let conversationItem = document.querySelector(`.conversation-item[data-conversation-id="${conversationId}"]`);
    
    if (conversationItem) {
        // Use cached elements if available
        let preview, timeElement;
        
        if (conversationCache.has(conversationId)) {
            const cache = conversationCache.get(conversationId);
            preview = cache.preview;
            timeElement = cache.timeElement;
        } else {
            preview = conversationItem.querySelector('.conversation-preview');
            timeElement = conversationItem.querySelector('.conversation-time');
            conversationCache.set(conversationId, { preview, timeElement });
        }
        
        // Batch DOM updates
        requestAnimationFrame(() => {
            // Update last message preview
            if (preview) {
                const isCurrentUser = message.sender._id === currentUser.id;
                const content = message.content || '';
                const previewText = (isCurrentUser ? 'You: ' : '') + 
                                  (content.length > 30 ? content.substring(0, 30) + '...' : content);
                
                if (preview.textContent !== previewText) {
                    preview.textContent = previewText;
                }
            }
            
            // Update timestamp
            if (timeElement) {
                const newTime = new Date(message.createdAt).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                
                if (timeElement.textContent !== newTime) {
                    timeElement.textContent = newTime;
                }
            }
            
            // Move to top if not active
            if (currentConversation !== conversationId) {
                if (!conversationItem.classList.contains('unread')) {
                    conversationItem.classList.add('unread');
                }
                
                const conversationsList = document.getElementById('conversations');
                if (conversationsList && conversationsList.firstChild !== conversationItem) {
                    conversationsList.insertBefore(conversationItem, conversationsList.firstChild);
                }
            }
        });
    } else {
        // If conversation doesn't exist in the list, reload conversations
        // but debounce to prevent rapid reloads
        if (!this._reloadTimeout) {
            this._reloadTimeout = setTimeout(() => {
                loadConversations();
                this._reloadTimeout = null;
            }, 500);
        }
    }
}

// Mark messages as read
async function markMessagesAsRead(conversationId) {
    try {
        const token = localStorage.getItem('token');
        await fetch(`${API_BASE_URL}/api/messages/read/${conversationId}`, {
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
    // No redirect. Only show error message.
}

// Start a new conversation
async function startNewConversation(ideaId, recipientId) {
    currentIdea = ideaId;
    
    try {
        const token = localStorage.getItem('token');
        
        // Create a new conversation
        const response = await fetch(`${API_BASE_URL}/api/messages`, {
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
