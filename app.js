// Snappic App Logic
const API_URL = '';
let currentUser = null;
let currentChatUserId = null;
let socket = null;
let allUsersCache = {};
let unreadMessages = 0;
let unreadNotifications = 0;

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

const getAvatarHtml = (avatarStr) => {
    if (avatarStr && avatarStr.startsWith('data:image')) {
        return `<img src="${avatarStr}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    }
    return avatarStr || '';
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
        document.getElementById('nav-avatar').innerHTML = getAvatarHtml(currentUser.avatar);

        initSocket();
        loadPrompt();
        loadFeed();
        loadSuggestions();
        loadNotifications();
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
        } else if (target === 'notifications-view') {
            unreadNotifications = 0;
            updateBadge();
            markNotificationsRead();
            loadNotifications();
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
    const postType = document.getElementById('post-type-select').value;
    const isPromptResponse = document.getElementById('post-is-prompt').checked;
    const unlockHours = document.getElementById('post-unlock-select').value;
    
    if (!caption && !selectedImageBase64) return showToast('Please add an image or caption');

    document.getElementById('submit-post-btn').innerText = 'Posting...';
    
    try {
        const res = await fetch(API_URL + '/api/posts', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('snappic_token')}`
            },
            body: JSON.stringify({ caption, image: selectedImageBase64, postType, isPromptResponse, unlockHours })
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
    document.getElementById('post-type-select').value = 'post';
    document.getElementById('post-is-prompt').checked = false;
    document.getElementById('post-unlock-select').value = '0';
    imageInput.value = '';
}

// Feed Generation
async function loadPrompt() {
    try {
        const res = await fetch(API_URL + '/api/prompt', { headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` } });
        const data = await res.json();
        document.getElementById('daily-prompt-text').innerText = data.prompt;
        document.getElementById('daily-prompt-banner').classList.remove('hidden');
    } catch (e) {}
}

async function loadFeed() {
    const token = localStorage.getItem('snappic_token');
    try {
        const res = await fetch(API_URL + '/api/posts', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        
        const container = document.getElementById('feed-container');
        container.innerHTML = '';
        
        const promptContainer = document.getElementById('prompt-responses-container');
        if (promptContainer) {
            promptContainer.innerHTML = '';
            const promptPosts = data.posts.filter(p => p.isPromptResponse);
            if (promptPosts.length > 0) {
                promptContainer.classList.remove('hidden');
                promptPosts.forEach(p => {
                    const b = document.createElement('div');
                    b.style = "min-width: 65px; height: 65px; border-radius: 50%; border: 3px solid var(--primary); padding: 3px; cursor: pointer; flex-shrink: 0;";
                    b.innerHTML = `<div class="avatar" style="width:100%; height:100%; border-radius:50%; overflow:hidden;">${getAvatarHtml(p.author.avatar)}</div>`;
                    b.onclick = () => {
                        const postEl = document.getElementById(`post-${p.id}`);
                        if(postEl) postEl.scrollIntoView({behavior: 'smooth'});
                    };
                    promptContainer.appendChild(b);
                });
            } else {
                promptContainer.classList.add('hidden');
            }
        }

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
    const isLocked = post.unlockDate && new Date(post.unlockDate) > new Date();
    
    const div = document.createElement('div');
    div.className = 'post-card';
    div.id = `post-${post.id}`;
    
    let commentsHtml = '';
    if (post.comments) {
        post.comments.forEach(c => {
            commentsHtml += `<div class="comment"><strong>${escapeHtml(c.username)}</strong> ${escapeHtml(c.text)}</div>`;
        });
    }

    let innerContent = '';
    if (isLocked) {
        innerContent = `
            <div class="time-capsule-container">
                <i class="ri-lock-fill" style="font-size:3rem; color:var(--accent); margin-bottom:10px; display:inline-block;"></i>
                <h4>Time Capsule</h4>
                <p>Unlocks in: <span class="countdown-timer" data-unlock="${post.unlockDate}" style="font-weight:bold; color:var(--accent);">Loading...</span></p>
            </div>
        `;
    } else {
        innerContent = `
            ${post.image ? `<img src="${post.image}" class="post-image" loading="lazy" onclick="openImageViewer('${post.image}')" style="cursor: zoom-in;">` : ''}
            <div class="post-caption">
                <strong>${escapeHtml(post.author.username)}</strong> ${escapeHtml(post.caption)}
                ${post.isPromptResponse ? '<span style="display:inline-block; background:var(--primary-light); color:var(--primary); padding:2px 8px; border-radius:10px; font-size:0.75rem; font-weight:bold; margin-left:10px;"><i class="ri-fire-fill"></i> Daily Prompt</span>' : ''}
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
            <button onclick="toggleComments('${post.id}')" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.9rem; margin-bottom:10px; font-weight:500;">Toggle Comments</button>
            <div class="post-comments" id="comments-${post.id}">
                ${commentsHtml}
            </div>
            <div class="comment-input-area">
                <input type="text" id="comment-input-${post.id}" placeholder="Add a comment..." onkeypress="if(event.key === 'Enter') addComment('${post.id}')">
                <button onclick="addComment('${post.id}')">Post</button>
            </div>
        `;
    }

    div.innerHTML = `
        <div class="post-header">
            <div class="post-user" onclick="loadProfile('${post.author.id}')">
                <div class="avatar">${getAvatarHtml(post.author.avatar)}</div>
                <div>
                    <div class="name">${escapeHtml(post.author.username)}</div>
                    <div class="time">${formatTime(post.createdAt)}</div>
                </div>
            </div>
            <button class="post-opt" ${post.author.id === currentUser.id ? `onclick="deletePost('${post.id}')" title="Delete Post"` : ''}>
                <i class="${post.author.id === currentUser.id ? 'ri-delete-bin-line' : 'ri-more-2-fill'}" ${post.author.id === currentUser.id ? 'style="color: #ef4444;"' : ''}></i>
            </button>
        </div>
        ${innerContent}
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
    } catch (e) {
        console.error(e);
    }
};

window.deletePost = async (postId) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
        const res = await fetch(API_URL + `/api/posts/${postId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        if (data.success) {
            showToast('Post deleted!');
            // DOM update handled by socket
            if (document.getElementById('profile-view').classList.contains('hidden') === false) {
                // Refresh profile if we are on it
                loadProfile(currentUser.id);
            }
        }
    } catch (e) {
        console.error(e);
        showToast('Failed to delete post');
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

window.toggleComments = (postId) => {
    const commentsDiv = document.getElementById(`comments-${postId}`);
    const inputArea = document.querySelector(`#post-${postId} .comment-input-area`);
    if (commentsDiv) commentsDiv.classList.toggle('hidden');
    if (inputArea) inputArea.classList.toggle('hidden');
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
                    <div class="avatar">${getAvatarHtml(u.avatar)}</div>
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
                    <div class="avatar">${getAvatarHtml(u.avatar)}</div>
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
        document.getElementById('profile-avatar').innerHTML = getAvatarHtml(user.avatar);
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
            editBtn.onclick = () => document.getElementById('avatar-upload-input').click();
            actionsDiv.appendChild(editBtn);
        }
        
        const gridPost = document.getElementById('profile-grid-post');
        const gridNote = document.getElementById('profile-grid-note');
        gridPost.innerHTML = '';
        gridNote.innerHTML = '';
        data.posts.forEach(p => {
            const div = document.createElement('div');
            div.className = 'grid-post';
            div.innerHTML = `
                ${p.image ? `<img src="${p.image}" loading="lazy" onclick="openImageViewer('${p.image}')" style="cursor: zoom-in;">` : `<div style="padding:1rem; height:100%; display:flex; align-items:center; text-align:center;">${escapeHtml(p.caption)}</div>`}
                <div class="grid-post-overlay">
                    <span><i class="ri-heart-3-fill"></i> ${p.likes.length}</span>
                    <span><i class="ri-chat-3-fill"></i> ${p.comments.length}</span>
                </div>
            `;
            if (p.postType === 'note') {
                gridNote.appendChild(div);
            } else {
                gridPost.appendChild(div);
            }
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
                <div class="avatar">${getAvatarHtml(u.avatar)}</div>
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
    document.getElementById('chat-active-avatar').innerHTML = getAvatarHtml(avatar);
    
    // Apply theme
    applyChatTheme(currentUser.chatTheme || 'default');
    document.getElementById('chat-theme-select').value = currentUser.chatTheme || 'default';
    
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
    const isMe = msg.senderId === currentUser.id;
    
    let div = document.getElementById(`msg-${msg.id}`);
    if (!div) {
        div = document.createElement('div');
        div.id = `msg-${msg.id}`;
        container.appendChild(div);
    }
    
    div.className = `msg ${isMe ? 'sent' : 'received'}`;
    let html = `<span>${escapeHtml(msg.text)}</span>`;
    if (isMe) {
        html += ` <button onclick="editMessage('${msg.id}', '${escapeHtml(msg.text).replace(/'/g, "\\'")}')" class="edit-msg-btn"><i class="ri-edit-line"></i></button>`;
    }
    div.innerHTML = html;
}

window.editMessage = (messageId, oldText) => {
    const newText = prompt("Edit message:", oldText);
    if (newText !== null && newText.trim() !== "") {
        socket.emit('edit_direct_message', { messageId, newText: newText.trim() });
    }
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

function updateBadge() {
    const msgBadge = document.getElementById('msg-badge');
    const mobileMsgBadge = document.getElementById('mobile-msg-badge');
    const notifBadge = document.getElementById('notif-badge');
    const mobileNotifBadge = document.getElementById('mobile-notif-badge');
    
    if (unreadMessages > 0) {
        msgBadge.innerText = unreadMessages;
        msgBadge.style.display = 'block';
        if (mobileMsgBadge) { mobileMsgBadge.innerText = unreadMessages; mobileMsgBadge.style.display = 'block'; }
    } else {
        msgBadge.style.display = 'none';
        if (mobileMsgBadge) mobileMsgBadge.style.display = 'none';
    }
    
    if (unreadNotifications > 0) {
        if(notifBadge) notifBadge.style.display = 'block';
        if(mobileNotifBadge) mobileNotifBadge.style.display = 'block';
    } else {
        if(notifBadge) notifBadge.style.display = 'none';
        if(mobileNotifBadge) mobileNotifBadge.style.display = 'none';
    }
}

// Notifications Logic
async function loadNotifications() {
    try {
        const res = await fetch(API_URL + '/api/notifications', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        
        const list = document.getElementById('notifications-list');
        if (!list) return;
        list.innerHTML = '';
        
        if (!data.notifications || data.notifications.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted);">No new notifications</div>';
            return;
        }
        
        data.notifications.forEach(n => {
            const div = document.createElement('div');
            div.style = "display:flex; align-items:center; gap: 1rem; padding: 10px; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border);";
            
            let text = '';
            if (n.type === 'like') text = 'liked your post.';
            if (n.type === 'comment') text = 'commented on your post.';
            if (n.type === 'follow') text = 'started following you.';
            if (n.type === 'message') text = 'sent you a message.';
            
            div.innerHTML = `
                <div class="avatar">${getAvatarHtml(n.senderAvatar)}</div>
                <div style="flex:1;">
                    <strong>${escapeHtml(n.senderUsername)}</strong> ${text}
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${formatTime(n.createdAt)}</div>
                </div>
                ${!n.read ? '<div style="width:10px; height:10px; background:var(--primary); border-radius:50%;"></div>' : ''}
            `;
            div.onclick = () => {
                if(n.type === 'follow') loadProfile(n.senderId);
                if(n.type === 'message') openChat(n.senderId, n.senderUsername, n.senderAvatar);
                // Can add post viewing for like/comment later
            };
            list.appendChild(div);
        });
    } catch (e) {
        console.error(e);
    }
}

async function markNotificationsRead() {
    try {
        await fetch(API_URL + '/api/notifications/read', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
    } catch(e) {}
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
    
    socket.on('post_deleted', ({ postId }) => {
        const postCard = document.getElementById(`post-${postId}`);
        if (postCard) postCard.remove();
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
    
    socket.on('new_notification', (notif) => {
        showToast('New notification!');
        unreadNotifications++;
        updateBadge();
        loadNotifications();
    });
    
    socket.on('message_edited', (msg) => {
        appendMessage(msg);
    });

    socket.on('room_history', (msgs) => {
        document.getElementById('room-messages-container').innerHTML = '';
        msgs.forEach(m => appendRoomMessage(m));
        scrollRoomToBottom();
    });

    socket.on('new_room_message', ({ roomId, msg }) => {
        if (currentRoomId === roomId) {
            appendRoomMessage(msg);
            scrollRoomToBottom();
        }
    });
}

document.getElementById('mobile-chat-btn').addEventListener('click', () => {
    document.querySelectorAll('.nav-item[data-target="chat-view"]')[0].click();
});

// Avatar Upload
document.getElementById('profile-avatar').addEventListener('click', () => {
    if (document.getElementById('profile-view').classList.contains('hidden')) return;
    // Only allow changing own avatar (the button is only visible for own profile if we set it right, actually the avatar is always there, let's just check if it's our profile)
    // Actually, when loading profile, we only add "Edit Profile" if it's our profile.
    // Let's just trigger it. We will verify on the backend anyway.
    if (document.getElementById('profile-username').innerText === currentUser.username) {
        document.getElementById('avatar-upload-input').click();
    }
});

document.getElementById('avatar-upload-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
        const base64 = event.target.result;
        try {
            const res = await fetch(API_URL + '/api/users/avatar', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('snappic_token')}`
                },
                body: JSON.stringify({ avatar: base64 })
            });
            const data = await res.json();
            if (data.success) {
                currentUser.avatar = data.avatar;
                document.getElementById('nav-avatar').innerHTML = getAvatarHtml(currentUser.avatar);
                document.getElementById('profile-avatar').innerHTML = getAvatarHtml(currentUser.avatar);
                showToast('Profile picture updated!');
            }
        } catch (error) {
            showToast('Failed to update profile picture');
        }
    };
    reader.readAsDataURL(file);
});

// Chat Themes
document.getElementById('chat-theme-select').addEventListener('change', async (e) => {
    const theme = e.target.value;
    applyChatTheme(theme);
    
    try {
        await fetch(API_URL + '/api/users/theme', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('snappic_token')}`
            },
            body: JSON.stringify({ chatTheme: theme })
        });
        currentUser.chatTheme = theme;
    } catch (error) {
        console.error('Failed to save theme');
    }
});

function applyChatTheme(theme) {
    const container = document.getElementById('messages-container');
    if (theme === 'whatsapp') {
        container.style.backgroundColor = '#efeae2';
        container.style.backgroundImage = 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")';
        container.style.backgroundRepeat = 'repeat';
        container.style.backgroundSize = '400px';
        container.style.backgroundBlendMode = 'normal';
    } else if (theme === 'dark') {
        container.style.backgroundColor = '#0f172a';
        container.style.backgroundImage = 'none';
    } else {
        container.style.backgroundColor = 'transparent';
        container.style.backgroundImage = 'none';
    }
}

// Image Viewer
window.openImageViewer = (src) => {
    document.getElementById('image-viewer-img').src = src;
    document.getElementById('image-viewer-modal').classList.add('active');
};

document.getElementById('close-image-viewer').addEventListener('click', () => {
    document.getElementById('image-viewer-modal').classList.remove('active');
});

document.getElementById('image-viewer-img').addEventListener('click', () => {
    document.getElementById('image-viewer-modal').classList.remove('active');
});

// Profile Tabs
document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.profile-tab').forEach(t => {
            t.classList.remove('active');
            t.style.borderBottomColor = 'transparent';
            t.style.color = 'var(--text-muted)';
        });
        tab.classList.add('active');
        tab.style.borderBottomColor = 'var(--primary)';
        tab.style.color = 'var(--text-main)';
        
        const type = tab.getAttribute('data-type');
        if (type === 'note') {
            document.getElementById('profile-grid-post').classList.add('hidden');
            document.getElementById('profile-grid-note').classList.remove('hidden');
        } else {
            document.getElementById('profile-grid-note').classList.add('hidden');
            document.getElementById('profile-grid-post').classList.remove('hidden');
        }
    });
});

// Global Countdown Timer
setInterval(() => {
    document.querySelectorAll('.countdown-timer').forEach(el => {
        const unlockDate = new Date(el.getAttribute('data-unlock'));
        const now = new Date();
        const diff = Math.floor((unlockDate - now) / 1000);
        if (diff <= 0) {
            el.innerText = 'Unlocked! Refresh feed.';
        } else {
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            el.innerText = `${h}h ${m}m ${s}s`;
        }
    });
}, 1000);

// Campus Rooms Logic
let currentRoomId = null;

window.joinRoom = (roomId, element) => {
    currentRoomId = roomId;
    const names = { 'library': 'Library Grind', 'chill': 'Late Night Chill', 'confessions': 'Confessions (Anon)' };
    document.getElementById('room-active-name').innerText = names[roomId];
    document.getElementById('room-messages-container').innerHTML = '';
    document.getElementById('room-active-state').style.opacity = '1';
    
    document.querySelectorAll('#rooms-list .convo-item').forEach(el => el.classList.remove('active'));
    if(element) element.classList.add('active');
    
    socket.emit('join_room', roomId);
    if (window.innerWidth <= 768) {
        document.getElementById('room-chat-area').classList.add('active');
    }
};

function appendRoomMessage(msg) {
    const container = document.getElementById('room-messages-container');
    if (!container) return;
    const isMe = msg.senderId === currentUser.id;
    const div = document.createElement('div');
    div.className = `msg ${isMe ? 'sent' : 'received'}`;
    div.innerHTML = `<div style="font-size:0.75rem; opacity:0.7; margin-bottom:4px; font-weight:600;">${escapeHtml(msg.senderName)}</div><span>${escapeHtml(msg.text)}</span>`;
    container.appendChild(div);
}

function scrollRoomToBottom() {
    const container = document.getElementById('room-messages-container');
    if (container) container.scrollTop = container.scrollHeight;
}

document.getElementById('send-room-msg-btn')?.addEventListener('click', sendRoomMessage);
document.getElementById('room-message-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendRoomMessage();
});

function sendRoomMessage() {
    const input = document.getElementById('room-message-input');
    const text = input.value.trim();
    if (!text || !currentRoomId) return;
    socket.emit('room_message', { roomId: currentRoomId, text });
    input.value = '';
}

// Run Init
initApp();
