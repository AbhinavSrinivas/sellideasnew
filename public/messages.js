// Global variables
let currentUser = null;
let currentConversation = null;
let currentIdea = null;
let pollingInterval = null;
let isPageVisible = true;

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
    // Add visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    checkAuth();
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    if (messageForm) {
        messageForm.addEventListener('submit', sendMessage);
    }
});

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
    stopPolling();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
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
        
        // Start polling for new messages
        startPolling();
        
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
    if (!content || !currentConversation) return;
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                recipientId: document.querySelector('.conversation-item.active').getAttribute('data-other-user-id'),
                content,
                ideaId: currentIdea
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to send message');
        }
        
        // Clear input and refresh messages
        messageInput.value = '';
        await loadMessages(currentConversation);
        await loadConversations();
        
    } catch (error) {
        console.error('Error sending message:', error);
        showMessage('Error sending message', 'error');
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
