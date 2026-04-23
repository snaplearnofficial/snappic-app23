// Snappic App Logic
const API_URL = '';
let currentUser = null;
let currentChatUserId = null;
let socket = null;
let allUsersCache = {};
let unreadMessages = 0;

// Utility functions
const showToast = (msg) => {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

const formatTime = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
};

const escapeHtml = (unsafe) => {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
};

// Auth Logic
let isLoginMode = true;
const authContainer = document.getElementById('auth');
const appContainer = document.getElementById('app');

document.getElementById('auth-switch-btn').addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? 'Welcome back' : 'Create an account';
    document.getElementById('username-group').classList.toggle('hidden', isLoginMode);
    document.getElementById('auth-submit').innerText = isLoginMode ? 'Log In' : 'Sign Up';
    document.getElementById('auth-switch-text').innerText = isLoginMode ? "Don't have an account?" : "Already have an account?";
    document.getElementById('auth-switch-btn').innerText = isLoginMode ? 'Sign up' : 'Log in';
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const username = document.getElementById('auth-username').value;

    const endpoint = isLoginMode ? '/api/login' : '/api/register';
    const body = isLoginMode ? { email, password } : { username, email, password };

    try {
        const res = await fetch(API_URL + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        
        if (data.error) return showToast(data.error);
        
        localStorage.setItem('snappic_token', data.token);
        initApp();
    } catch (e) {
        showToast('Connection error');
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('snappic_token');
    location.reload();
});

// App Initialization
async function initApp() {
    const token = localStorage.getItem('snappic_token');
    if (!token) return;

    try {
        const res = await fetch(API_URL + '/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        
        if (data.error) {
            localStorage.removeItem('snappic_token');
            return;
        }

        currentUser = data.user;
        authContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');

        // Setup User Info
        document.getElementById('nav-username').innerText = currentUser.username;
        document.getElementById('nav-avatar').innerText = currentUser.avatar;

        initSocket();
        loadFeed();
        loadSuggestions();
    } catch (e) {
        console.error(e);
    }
}

// Navigation
document.querySelectorAll('.nav-item[data-target]').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = item.getAttribute('data-target');
        
        document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
        document.getElementById(target).classList.remove('hidden');
        
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll(`.nav-item[data-target="${target}"]`).forEach(n => n.classList.add('active'));

        if (target === 'chat-view') {
            loadConversations();
            unreadMessages = 0;
            updateBadge();
        } else if (target === 'profile-view') {
            loadProfile(currentUser.id);
        } else if (target === 'feed-view') {
            loadFeed();
        }
    });
});

// Create Post Modal
const postModal = document.getElementById('create-post-modal');
document.getElementById('open-post-modal').addEventListener('click', () => postModal.classList.add('active'));
document.getElementById('open-post-modal-mobile').addEventListener('click', () => postModal.classList.add('active'));
document.querySelector('.close-modal').addEventListener('click', () => {
    postModal.classList.remove('active');
    resetPostModal();
});

let selectedImageBase64 = null;
const imageInput = document.getElementById('post-image-input');
const imagePreview = document.getElementById('post-image-preview');

document.getElementById('image-upload-area').addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            selectedImageBase64 = event.target.result;
            imagePreview.src = selectedImageBase64;
            imagePreview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
});

document.getElementById('submit-post-btn').addEventListener('click', async () => {
    const caption = document.getElementById('post-caption').value;
    if (!caption && !selectedImageBase64) return showToast('Please add an image or caption');

    document.getElementById('submit-post-btn').innerText = 'Posting...';
    
    try {
        const res = await fetch(API_URL + '/api/posts', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('snappic_token')}`
            },
            body: JSON.stringify({ caption, image: selectedImageBase64 })
        });
        
        if (res.ok) {
            postModal.classList.remove('active');
            resetPostModal();
            showToast('Post shared!');
        }
    } catch (e) {
        showToast('Failed to post');
    }
    document.getElementById('submit-post-btn').innerText = 'Share Post';
});

function resetPostModal() {
    selectedImageBase64 = null;
    imagePreview.src = '';
    imagePreview.classList.add('hidden');
    document.getElementById('post-caption').value = '';
    imageInput.value = '';
}

// Feed Generation
async function loadFeed() {
    const token = localStorage.getItem('snappic_token');
    try {
        const res = await fetch(API_URL + '/api/posts', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        
        const container = document.getElementById('feed-container');
        container.innerHTML = '';
        
        if (!data.posts || data.posts.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 3rem; color: var(--text-muted);">No posts yet. Follow people to see their posts!</div>';
            return;
        }

        data.posts.forEach(post => {
            container.appendChild(createPostElement(post));
        });
    } catch (e) {
        console.error(e);
    }
}

function createPostElement(post) {
    const div = document.createElement('div');
    div.className = 'post-card';
    div.id = `post-${post.id}`;
    
    let commentsHtml = '';
    if (post.comments) {
        post.comments.forEach(c => {
            commentsHtml += `<div class="comment"><strong>${escapeHtml(c.username)}</strong> ${escapeHtml(c.text)}</div>`;
        });
    }

    div.innerHTML = `
        <div class="post-header">
            <div class="post-user" onclick="loadProfile('${post.author.id}')">
                <div class="avatar">${post.author.avatar}</div>
                <div>
                    <div class="name">${escapeHtml(post.author.username)}</div>
                    <div class="time">${formatTime(post.createdAt)}</div>
                </div>
            </div>
            <button class="post-opt"><i class="ri-more-2-fill"></i></button>
        </div>
        ${post.image ? `<img src="${post.image}" class="post-image" loading="lazy">` : ''}
        <div class="post-caption">
            <strong>${escapeHtml(post.author.username)}</strong> ${escapeHtml(post.caption)}
        </div>
        <div class="post-actions">
            <button class="action-btn ${post.isLiked ? 'liked' : ''}" onclick="toggleLike('${post.id}')">
                <i class="${post.isLiked ? 'ri-heart-3-fill' : 'ri-heart-3-line'}"></i>
                <span id="like-count-${post.id}">${post.likes}</span>
            </button>
            <button class="action-btn" onclick="document.getElementById('comment-input-${post.id}').focus()">
                <i class="ri-chat-3-line"></i>
                <span id="comment-count-${post.id}">${post.commentCount}</span>
            </button>
            <button class="action-btn" onclick="copyLink('${post.id}')">
                <i class="ri-share-forward-line"></i>
            </button>
        </div>
        <div class="post-comments" id="comments-${post.id}">
            ${commentsHtml}
        </div>
        <div class="comment-input-area">
            <input type="text" id="comment-input-${post.id}" placeholder="Add a comment..." onkeypress="if(event.key === 'Enter') addComment('${post.id}')">
            <button onclick="addComment('${post.id}')">Post</button>
        </div>
    `;
    return div;
}

window.toggleLike = async (postId) => {
    try {
        const res = await fetch(API_URL + `/api/posts/${postId}/like`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        // UI updates handled by socket
    } catch (e) {
        console.error(e);
    }
};

window.addComment = async (postId) => {
    const input = document.getElementById(`comment-input-${postId}`);
    const text = input.value.trim();
    if (!text) return;
    
    input.value = '';
    try {
        await fetch(API_URL + `/api/posts/${postId}/comment`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('snappic_token')}`
            },
            body: JSON.stringify({ text })
        });
        // UI update via socket
    } catch (e) {
        console.error(e);
    }
};

window.copyLink = (postId) => {
    navigator.clipboard.writeText(window.location.origin + '?post=' + postId);
    showToast('Link copied to clipboard!');
};

// Explore / Search
document.getElementById('search-input').addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const resultsContainer = document.getElementById('search-results');
    
    if (!q) {
        resultsContainer.innerHTML = '';
        return;
    }
    
    try {
        const res = await fetch(API_URL + `/api/users/search?q=${q}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        
        resultsContainer.innerHTML = '';
        data.users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'search-user-card';
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:1rem;">
                    <div class="avatar">${u.avatar}</div>
                    <strong style="font-size:1.1rem">${escapeHtml(u.username)}</strong>
                </div>
                <button class="btn-primary" style="padding: 6px 15px; border-radius: 20px;">View</button>
            `;
            div.onclick = () => loadProfile(u.id);
            resultsContainer.appendChild(div);
        });
    } catch (e) {
        console.error(e);
    }
});

async function loadSuggestions() {
    try {
        const res = await fetch(API_URL + `/api/users/search?q=`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        
        const container = document.getElementById('suggestions-list');
        container.innerHTML = '';
        
        data.users.filter(u => u.id !== currentUser.id).slice(0, 5).forEach(u => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `
                <div class="suggestion-user" onclick="loadProfile('${u.id}')">
                    <div class="avatar">${u.avatar}</div>
                    <div class="name">${escapeHtml(u.username)}</div>
                </div>
                <button class="follow-btn-small" onclick="loadProfile('${u.id}')">View</button>
            `;
            container.appendChild(div);
        });
    } catch (e) {}
}

// Profile View
window.loadProfile = async (userId) => {
    try {
        const res = await fetch(API_URL + `/api/users/${userId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        
        if (data.error) return showToast(data.error);
        
        const user = data.user;
        document.getElementById('profile-username').innerText = user.username;
        document.getElementById('profile-avatar').innerText = user.avatar;
        document.getElementById('profile-posts-count').innerText = data.posts.length;
        document.getElementById('profile-followers').innerText = user.followers;
        document.getElementById('profile-following').innerText = user.following;
        
        const actionsDiv = document.getElementById('profile-actions');
        actionsDiv.innerHTML = '';
        
        if (user.id !== currentUser.id) {
            const followBtn = document.createElement('button');
            followBtn.className = user.isFollowing ? 'btn-secondary' : 'btn-primary';
            followBtn.innerText = user.isFollowing ? 'Following' : 'Follow';
            followBtn.onclick = () => toggleFollow(user.id, followBtn);
            
            const msgBtn = document.createElement('button');
            msgBtn.className = 'btn-secondary';
            msgBtn.innerHTML = '<i class="ri-message-3-line"></i> Message';
            msgBtn.onclick = () => openChat(user.id, user.username, user.avatar);
            
            actionsDiv.appendChild(followBtn);
            actionsDiv.appendChild(msgBtn);
        } else {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-secondary';
            editBtn.innerText = 'Edit Profile';
            actionsDiv.appendChild(editBtn);
        }
        
        const grid = document.getElementById('profile-grid');
        grid.innerHTML = '';
        data.posts.forEach(p => {
            const div = document.createElement('div');
            div.className = 'grid-post';
            div.innerHTML = `
                ${p.image ? `<img src="${p.image}" loading="lazy">` : `<div style="padding:1rem; height:100%; display:flex; align-items:center; text-align:center;">${escapeHtml(p.caption)}</div>`}
                <div class="grid-post-overlay">
                    <span><i class="ri-heart-3-fill"></i> ${p.likes.length}</span>
                    <span><i class="ri-chat-3-fill"></i> ${p.comments.length}</span>
                </div>
            `;
            grid.appendChild(div);
        });
        
        document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
        document.getElementById('profile-view').classList.remove('hidden');
    } catch (e) {
        console.error(e);
    }
};

async function toggleFollow(userId, btnElement) {
    try {
        const res = await fetch(API_URL + `/api/users/${userId}/follow`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        if (data.success) {
            btnElement.className = data.isFollowing ? 'btn-secondary' : 'btn-primary';
            btnElement.innerText = data.isFollowing ? 'Following' : 'Follow';
            document.getElementById('profile-followers').innerText = data.followers;
        }
    } catch (e) {
        console.error(e);
    }
}

// Chat Logic
async function loadConversations() {
    try {
        const res = await fetch(API_URL + '/api/conversations', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        
        const list = document.getElementById('conversations-list');
        list.innerHTML = '';
        
        data.users.forEach(u => {
            allUsersCache[u.id] = u;
            const div = document.createElement('div');
            div.className = `convo-item ${u.id === currentChatUserId ? 'active' : ''}`;
            div.onclick = () => openChat(u.id, u.username, u.avatar);
            div.innerHTML = `
                <div class="avatar">${u.avatar}</div>
                <div class="convo-info">
                    <div class="convo-name">${escapeHtml(u.username)}</div>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

window.openChat = async (userId, username, avatar) => {
    currentChatUserId = userId;
    
    // UI setup
    document.getElementById('chat-empty-state').classList.add('hidden');
    document.getElementById('chat-active-state').classList.remove('hidden');
    document.getElementById('chat-active-name').innerText = username;
    document.getElementById('chat-active-avatar').innerText = avatar;
    
    // Mobile view switch
    if (window.innerWidth <= 768) {
        document.getElementById('chat-area').classList.add('active');
    }
    
    // Switch to chat tab if not already
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById('chat-view').classList.remove('hidden');
    
    // Highlight sidebar
    document.querySelectorAll('.convo-item').forEach(i => i.classList.remove('active'));
    
    try {
        const res = await fetch(API_URL + `/api/messages/${userId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        
        data.messages.forEach(m => appendMessage(m));
        scrollToBottom();
    } catch (e) { console.error(e); }
};

document.getElementById('close-chat-mobile').addEventListener('click', () => {
    document.getElementById('chat-area').classList.remove('active');
    currentChatUserId = null;
});

document.getElementById('send-msg-btn').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentChatUserId) return;
    
    socket.emit('direct_message', { receiverId: currentChatUserId, text });
    input.value = '';
}

function appendMessage(msg) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    const isMe = msg.senderId === currentUser.id;
    div.className = `msg ${isMe ? 'sent' : 'received'}`;
    div.innerText = msg.text;
    container.appendChild(div);
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

function updateBadge() {
    const badge = document.getElementById('msg-badge');
    if (unreadMessages > 0) {
        badge.innerText = unreadMessages;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
}

// Socket Initialization
function initSocket() {
    socket = io(API_URL, { transports: ['polling', 'websocket'] });
    
    socket.on('connect', () => {
        socket.emit('user_join', { id: currentUser.id });
    });
    
    socket.on('online_count', (count) => {
        document.getElementById('online-count-badge').innerText = count;
    });
    
    socket.on('new_post', (post) => {
        const container = document.getElementById('feed-container');
        const firstChild = container.firstChild;
        const newEl = createPostElement(post);
        if (firstChild && !container.innerHTML.includes('No posts yet')) {
            container.insertBefore(newEl, firstChild);
        } else {
            container.innerHTML = '';
            container.appendChild(newEl);
        }
    });
    
    socket.on('post_liked', ({ postId, likes, liked }) => {
        const postCard = document.getElementById(`post-${postId}`);
        if (postCard) {
            const countSpan = document.getElementById(`like-count-${postId}`);
            if (countSpan) countSpan.innerText = likes;
            
            // Only toggle visual state if this user did the liking, 
            // since socket broadcasts to all, we need to check state.
            // Actually, backend sends generic update, we just update count.
        }
    });
    
    socket.on('new_comment', ({ postId, comment, commentCount }) => {
        const postCard = document.getElementById(`post-${postId}`);
        if (postCard) {
            const countSpan = document.getElementById(`comment-count-${postId}`);
            if (countSpan) countSpan.innerText = commentCount;
            
            const commentsDiv = document.getElementById(`comments-${postId}`);
            if (commentsDiv) {
                const div = document.createElement('div');
                div.className = 'comment';
                div.innerHTML = `<strong>${escapeHtml(comment.username)}</strong> ${escapeHtml(comment.text)}`;
                commentsDiv.appendChild(div);
            }
        }
    });
    
    socket.on('new_direct_message', (msg) => {
        if (msg.senderId === currentChatUserId || msg.senderId === currentUser.id) {
            appendMessage(msg);
            scrollToBottom();
        } else if (msg.senderId !== currentUser.id) {
            showToast('New message received!');
            unreadMessages++;
            updateBadge();
            loadConversations(); // refresh list to show new sender
        }
    });
}

document.getElementById('mobile-chat-btn').addEventListener('click', () => {
    document.querySelectorAll('.nav-item[data-target="chat-view"]')[0].click();
});

// Run Init
initApp();
