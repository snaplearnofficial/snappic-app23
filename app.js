// SnapLearn App Logic
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

const getAvatarHtml = (avatarStr) => {
    if (avatarStr && avatarStr.startsWith('data:image')) {
        return `<img src="${avatarStr}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    }
    return avatarStr ? `<img src="${avatarStr}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : '<i class="ri-user-smile-fill"></i>';
};

// Auth Logic
let isLoginMode = true;
const authContainer = document.getElementById('auth');
const appContainer = document.getElementById('app');

document.getElementById('auth-switch-btn')?.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title-text').innerText = isLoginMode ? 'Log in or sign up' : 'Create an account';
    document.getElementById('username-group').classList.toggle('hidden', isLoginMode);
    document.getElementById('auth-submit').innerText = isLoginMode ? 'CONTINUE' : 'SIGN UP';
    document.getElementById('auth-switch-text').innerText = isLoginMode ? "Don't have account?" : "Already have account?";
    document.getElementById('auth-switch-btn').innerText = isLoginMode ? 'Sign up' : 'Log in';
});

document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
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
        
        // Show interest screen if newly registered
        if (!isLoginMode) {
            showInterestsScreen();
        } else {
            initApp();
        }
    } catch (e) {
        showToast('Connection error');
    }
});

function showInterestsScreen() {
    authContainer.innerHTML = `
        <div style="background: white; width: 100%; height: 100vh; padding: 40px 20px; display: flex; flex-direction: column; color: var(--text-main);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
                <i class="ri-arrow-left-line" style="font-size: 1.5rem; cursor: pointer;"></i>
                <span style="color: var(--text-muted); font-weight: 600; cursor: pointer;" onclick="initApp()">Skip</span>
            </div>
            <h1 style="font-size: 2.2rem; font-weight: 800; font-family: 'Outfit'; margin-bottom: 10px;">Choose your<br>interests</h1>
            <p style="color: var(--text-muted); margin-bottom: 40px;">Select subjects to personalize your feed.</p>
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: auto;">
                <div class="interest-item" onclick="this.classList.toggle('active')"><div class="icon"><i class="ri-microscope-line"></i></div><span>Biology</span></div>
                <div class="interest-item active" onclick="this.classList.toggle('active')"><div class="icon"><i class="ri-functions"></i></div><span>Math</span></div>
                <div class="interest-item" onclick="this.classList.toggle('active')"><div class="icon"><i class="ri-book-2-line"></i></div><span>English</span></div>
                <div class="interest-item active" onclick="this.classList.toggle('active')"><div class="icon"><i class="ri-rocket-line"></i></div><span>Physics</span></div>
                <div class="interest-item" onclick="this.classList.toggle('active')"><div class="icon"><i class="ri-flask-line"></i></div><span>Chemistry</span></div>
                <div class="interest-item" onclick="this.classList.toggle('active')"><div class="icon"><i class="ri-computer-line"></i></div><span>Coding</span></div>
            </div>
            
            <button onclick="initApp()" style="width: 100%; background: var(--primary); color: white; border: none; padding: 18px; border-radius: 15px; font-size: 1.1rem; font-weight: 700; cursor: pointer; box-shadow: 0 8px 20px rgba(0, 98, 230, 0.3);">NEXT</button>
        </div>
        <style>
            .interest-item { display: flex; flex-direction: column; align-items: center; gap: 10px; cursor: pointer; }
            .interest-item .icon { width: 70px; height: 70px; border-radius: 50%; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--primary); transition: all 0.2s; background: white; }
            .interest-item span { font-size: 0.9rem; font-weight: 600; color: var(--text-main); }
            .interest-item.active .icon { background: var(--primary-gradient); color: white; border-color: transparent; box-shadow: 0 5px 15px rgba(0, 98, 230, 0.3); }
        </style>
    `;
}

document.getElementById('logout-btn')?.addEventListener('click', () => {
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
        const headerName = document.getElementById('header-username');
        if(headerName) headerName.innerText = currentUser.username;
        document.getElementById('nav-avatar').innerHTML = getAvatarHtml(currentUser.avatar);

        initSocket();
        loadFeed();
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
document.getElementById('open-post-modal')?.addEventListener('click', () => postModal.classList.add('active'));
document.getElementById('open-post-modal-mobile')?.addEventListener('click', () => postModal.classList.add('active'));
document.querySelector('.close-modal')?.addEventListener('click', () => {
    postModal.classList.remove('active');
    resetPostModal();
});

let selectedImageBase64 = null;
const imageInput = document.getElementById('post-image-input');
const imagePreview = document.getElementById('post-image-preview');

document.getElementById('image-upload-area')?.addEventListener('click', () => imageInput.click());

imageInput?.addEventListener('change', (e) => {
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

document.getElementById('submit-post-btn')?.addEventListener('click', async () => {
    const caption = document.getElementById('post-caption').value;
    const postType = document.getElementById('post-type-select').value;
    
    if (!caption && !selectedImageBase64) return showToast('Please add content');

    document.getElementById('submit-post-btn').innerText = 'Uploading...';
    
    try {
        const res = await fetch(API_URL + '/api/posts', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('snappic_token')}`
            },
            body: JSON.stringify({ caption, image: selectedImageBase64, postType })
        });
        
        if (res.ok) {
            postModal.classList.remove('active');
            resetPostModal();
            showToast('Course content uploaded!');
        }
    } catch (e) {
        showToast('Failed to upload');
    }
    document.getElementById('submit-post-btn').innerText = 'Upload';
});

function resetPostModal() {
    selectedImageBase64 = null;
    imagePreview.src = '';
    imagePreview.classList.add('hidden');
    document.getElementById('post-caption').value = '';
    document.getElementById('post-type-select').value = 'math';
    imageInput.value = '';
}

// Feed Generation (TikTok Style)
async function loadFeed() {
    const token = localStorage.getItem('snappic_token');
    try {
        const res = await fetch(API_URL + '/api/posts', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        
        const container = document.getElementById('feed-container');
        container.innerHTML = '';
        
        if (!data.posts || data.posts.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 3rem; color: var(--text-muted);">No learning content yet!</div>';
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
    div.className = 'post-card tiktok-style-card';
    div.id = `post-${post.id}`;
    div.style = "position: relative; border-radius: 20px; overflow: hidden; margin-bottom: 25px; background: #000; color: white;";
    
    let commentsHtml = '';
    if (post.comments) {
        post.comments.forEach(c => {
            commentsHtml += `
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <div class="avatar" style="width: 35px; height: 35px;"></div>
                    <div>
                        <strong style="font-size: 0.9rem;">${escapeHtml(c.username)}</strong>
                        <p style="font-size: 0.95rem; margin-top: 2px;">${escapeHtml(c.text)}</p>
                    </div>
                </div>
            `;
        });
    }

    // TikTok structure
    div.innerHTML = `
        <div class="post-image-container" style="position: relative; height: 600px; display: flex; align-items: center; justify-content: center; background: #0f172a;">
            ${post.image ? `<img src="${post.image}" style="width: 100%; height: 100%; object-fit: contain;">` : `<div style="padding: 40px; font-size: 1.5rem; text-align: center; font-weight: 600;">${escapeHtml(post.caption)}</div>`}
            
            <div class="tiktok-overlay" style="position: absolute; right: 15px; bottom: 30px; display: flex; flex-direction: column; gap: 20px; align-items: center;">
                <button onclick="loadProfile('${post.author.id}')" style="background: none; border: none; cursor: pointer; position: relative;">
                    <div class="avatar" style="width: 50px; height: 50px; border: 2px solid white;">${getAvatarHtml(post.author.avatar)}</div>
                    <div style="background: #ef4444; color: white; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; position: absolute; bottom: -10px; left: 50%; transform: translateX(-50%); z-index: 2;">+</div>
                </button>
                <button class="tiktok-action ${post.isLiked ? 'liked' : ''}" onclick="toggleLike('${post.id}')" style="background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; color: white; text-shadow: 0 2px 5px rgba(0,0,0,0.5);">
                    <i class="${post.isLiked ? 'ri-heart-3-fill' : 'ri-heart-3-line'}" style="font-size: 2.2rem; transition: transform 0.2s; ${post.isLiked ? 'color: #ff2b55;' : ''}"></i>
                    <span id="like-count-${post.id}" style="font-weight: 600; font-size: 0.85rem; margin-top: 5px;">${post.likes}</span>
                </button>
                <button onclick="toggleComments('${post.id}')" style="background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; color: white; text-shadow: 0 2px 5px rgba(0,0,0,0.5);">
                    <i class="ri-chat-3-fill" style="font-size: 2.2rem; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.5));"></i>
                    <span id="comment-count-${post.id}" style="font-weight: 600; font-size: 0.85rem; margin-top: 5px;">${post.commentCount}</span>
                </button>
                <button onclick="copyLink('${post.id}')" style="background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; color: white; text-shadow: 0 2px 5px rgba(0,0,0,0.5);">
                    <i class="ri-share-forward-fill" style="font-size: 2.2rem; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.5));"></i>
                    <span style="font-weight: 600; font-size: 0.85rem; margin-top: 5px;">Share</span>
                </button>
            </div>
            
            <div style="position: absolute; bottom: 20px; left: 20px; right: 80px; z-index: 10;">
                <h3 style="margin-bottom: 8px; font-size: 1.1rem; text-shadow: 0 1px 3px rgba(0,0,0,0.8); font-weight: 700;">@${escapeHtml(post.author.username)}</h3>
                <p style="font-size: 0.95rem; text-shadow: 0 1px 3px rgba(0,0,0,0.8); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">${escapeHtml(post.caption)}</p>
                <div style="margin-top: 12px; background: rgba(0,0,0,0.4); padding: 6px 15px; border-radius: 20px; display: inline-flex; align-items: center; gap: 8px; backdrop-filter: blur(5px); font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.1);">
                    <i class="ri-music-2-fill"></i> Educational Sound - ${post.postType || 'Learning'}
                </div>
            </div>
        </div>
        
        <!-- Comments Bottom Sheet (Hidden by default) -->
        <div id="comments-sheet-${post.id}" class="hidden" style="background: white; color: var(--text-main); border-radius: 20px 20px 0 0; padding: 20px; position: absolute; bottom: 0; left: 0; right: 0; height: 60%; z-index: 20; display: flex; flex-direction: column; transition: transform 0.3s;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4 style="font-weight: 800; font-size: 1.2rem;">Comments <span id="sheet-comment-count-${post.id}" style="color: var(--text-muted); font-size: 1rem;">${post.commentCount}</span></h4>
                <button onclick="toggleComments('${post.id}')" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color: var(--text-main);"><i class="ri-close-line"></i></button>
            </div>
            <div id="comments-${post.id}" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; margin-bottom: 15px;">
                ${commentsHtml || '<div style="text-align:center; color: var(--text-muted); margin-top: 20px;">Be the first to comment!</div>'}
            </div>
            <div class="comment-input-area" style="background: #f4f7fb; padding: 10px 15px; border-radius: 25px; display: flex; align-items: center; gap: 10px; border: 1px solid var(--border);">
                <input type="text" id="comment-input-${post.id}" placeholder="Ask a question..." style="border: none; background: transparent; outline: none; flex: 1; font-size: 0.95rem;">
                <button onclick="addComment('${post.id}')" style="background: none; border: none; color: var(--primary); font-weight: 700; cursor: pointer; font-size: 1rem;">Send</button>
            </div>
        </div>
    `;
    return div;
}

window.toggleComments = (postId) => {
    const sheet = document.getElementById(`comments-sheet-${postId}`);
    if (sheet) sheet.classList.toggle('hidden');
};

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
    } catch (e) {
        console.error(e);
    }
};

window.copyLink = (postId) => {
    navigator.clipboard.writeText(window.location.origin + '?post=' + postId);
    showToast('Link copied to clipboard!');
};

// Explore / Search
document.getElementById('search-input')?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    
    // Switch to search view automatically if typing in dashboard
    if (q.length > 0) {
        document.querySelectorAll('.nav-item[data-target="courses-view"]')[0].click();
        const resultsContainer = document.getElementById('search-results');
        
        try {
            const res = await fetch(API_URL + `/api/users/search?q=${q}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
            });
            const data = await res.json();
            
            resultsContainer.innerHTML = '<h3>Mentors & Students</h3>';
            data.users.forEach(u => {
                const div = document.createElement('div');
                div.className = 'search-user-card';
                div.style = "display: flex; align-items: center; justify-content: space-between; background: white; padding: 15px; border-radius: 15px; margin-top: 10px; border: 1px solid var(--border); cursor: pointer;";
                div.innerHTML = `
                    <div style="display:flex; align-items:center; gap:15px;">
                        <div class="avatar" style="width: 50px; height: 50px;">${getAvatarHtml(u.avatar)}</div>
                        <div>
                            <strong style="font-size:1.1rem; display: block;">${escapeHtml(u.username)}</strong>
                            <span style="font-size:0.85rem; color:var(--text-muted);">Student</span>
                        </div>
                    </div>
                    <button style="background: var(--primary-light); color: var(--primary); border: none; padding: 8px 20px; border-radius: 20px; font-weight: 600;">View</button>
                `;
                div.onclick = () => loadProfile(u.id);
                resultsContainer.appendChild(div);
            });
        } catch (e) {}
    }
});

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
        gridPost.innerHTML = '';
        data.posts.forEach(p => {
            const div = document.createElement('div');
            div.style = "aspect-ratio: 9/16; background: #0f172a; border-radius: 15px; overflow: hidden; position: relative;";
            div.innerHTML = `
                ${p.image ? `<img src="${p.image}" style="width:100%; height:100%; object-fit:cover;">` : `<div style="padding:1rem; height:100%; display:flex; align-items:center; text-align:center; color:white;">${escapeHtml(p.caption)}</div>`}
                <div style="position: absolute; bottom: 10px; left: 10px; color: white; display: flex; gap: 10px; font-size: 0.8rem; font-weight: 600; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">
                    <span><i class="ri-play-fill"></i> ${p.likes.length * 12}</span>
                </div>
            `;
            gridPost.appendChild(div);
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
    } catch (e) {}
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
            div.style = "display: flex; align-items: center; gap: 15px; padding: 15px 20px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background 0.2s;";
            div.onclick = () => openChat(u.id, u.username, u.avatar);
            div.innerHTML = `
                <div class="avatar" style="width: 50px; height: 50px;">${getAvatarHtml(u.avatar)}</div>
                <div class="convo-info" style="flex: 1;">
                    <div class="convo-name" style="font-weight: 700; color: var(--text-main); font-size: 1.05rem;">${escapeHtml(u.username)}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Tap to chat</div>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) {}
}

window.openChat = async (userId, username, avatar) => {
    currentChatUserId = userId;
    
    document.getElementById('chat-empty-state').classList.add('hidden');
    document.getElementById('chat-active-state').classList.remove('hidden');
    document.getElementById('chat-active-name').innerText = username;
    document.getElementById('chat-active-avatar').innerHTML = getAvatarHtml(avatar);
    
    if (window.innerWidth <= 768) {
        document.getElementById('chat-area').classList.add('active');
    }
    
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById('chat-view').classList.remove('hidden');
    
    try {
        const res = await fetch(API_URL + `/api/messages/${userId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('snappic_token')}` }
        });
        const data = await res.json();
        
        const container = document.getElementById('messages-container');
        container.innerHTML = '';
        
        data.messages.forEach(m => appendMessage(m));
        scrollToBottom();
    } catch (e) {}
};

document.getElementById('close-chat-mobile')?.addEventListener('click', () => {
    document.getElementById('chat-area').classList.remove('active');
    currentChatUserId = null;
});

document.getElementById('send-msg-btn')?.addEventListener('click', sendMessage);
document.getElementById('message-input')?.addEventListener('keypress', (e) => {
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
    div.style = `max-width: 70%; padding: 12px 18px; border-radius: 20px; font-size: 0.95rem; line-height: 1.4; word-wrap: break-word; margin-bottom: 10px; ${isMe ? 'align-self: flex-end; background: var(--primary); color: white; border-bottom-right-radius: 5px;' : 'align-self: flex-start; background: white; color: var(--text-main); border-bottom-left-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);'}`;
    
    div.innerHTML = `<span>${escapeHtml(msg.text)}</span>`;
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    if(container) container.scrollTop = container.scrollHeight;
}

function updateBadge() {
    const msgBadge = document.getElementById('msg-badge');
    const mobileMsgBadge = document.getElementById('mobile-msg-badge');
    
    if (unreadMessages > 0) {
        if(msgBadge) { msgBadge.innerText = unreadMessages; msgBadge.style.display = 'block'; }
        if (mobileMsgBadge) { mobileMsgBadge.style.display = 'block'; }
    } else {
        if(msgBadge) msgBadge.style.display = 'none';
        if (mobileMsgBadge) mobileMsgBadge.style.display = 'none';
    }
}

// Socket Initialization
function initSocket() {
    socket = io(API_URL, { transports: ['polling', 'websocket'] });
    
    socket.on('connect', () => {
        socket.emit('user_join', { id: currentUser.id });
    });
    
    socket.on('new_post', (post) => {
        const container = document.getElementById('feed-container');
        const firstChild = container.firstChild;
        const newEl = createPostElement(post);
        if (firstChild && !container.innerHTML.includes('No learning content')) {
            container.insertBefore(newEl, firstChild);
        } else {
            container.innerHTML = '';
            container.appendChild(newEl);
        }
    });
    
    socket.on('post_liked', ({ postId, likes }) => {
        const countSpan = document.getElementById(`like-count-${postId}`);
        if (countSpan) countSpan.innerText = likes;
    });
    
    socket.on('new_comment', ({ postId, comment, commentCount }) => {
        const countSpan = document.getElementById(`comment-count-${postId}`);
        if (countSpan) countSpan.innerText = commentCount;
        
        const countSpanSheet = document.getElementById(`sheet-comment-count-${postId}`);
        if (countSpanSheet) countSpanSheet.innerText = commentCount;
        
        const commentsDiv = document.getElementById(`comments-${postId}`);
        if (commentsDiv) {
            if (commentsDiv.innerHTML.includes('Be the first')) commentsDiv.innerHTML = '';
            const div = document.createElement('div');
            div.style = "display: flex; gap: 10px; margin-bottom: 15px;";
            div.innerHTML = `
                <div class="avatar" style="width: 35px; height: 35px;"></div>
                <div>
                    <strong style="font-size: 0.9rem;">${escapeHtml(comment.username)}</strong>
                    <p style="font-size: 0.95rem; margin-top: 2px;">${escapeHtml(comment.text)}</p>
                </div>
            `;
            commentsDiv.appendChild(div);
            commentsDiv.scrollTop = commentsDiv.scrollHeight;
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
            loadConversations();
        }
    });
    
    // Room logic
    socket.on('room_history', (msgs) => {
        const container = document.getElementById('room-messages-container');
        if(!container) return;
        container.innerHTML = '';
        msgs.forEach(m => appendRoomMessage(m));
        container.scrollTop = container.scrollHeight;
    });

    socket.on('new_room_message', ({ roomId, msg }) => {
        if (currentRoomId === roomId) {
            appendRoomMessage(msg);
            const container = document.getElementById('room-messages-container');
            if(container) container.scrollTop = container.scrollHeight;
        }
    });
}

// Campus Rooms Logic
let currentRoomId = null;

window.joinRoom = (roomId, element) => {
    currentRoomId = roomId;
    const names = { 'library': 'Calculus 101', 'chill': 'Chemistry Lab', 'confessions': 'Coding Bootcamp' };
    document.getElementById('room-active-name').innerText = names[roomId] || 'Class';
    document.getElementById('room-messages-container').innerHTML = '';
    document.getElementById('room-active-state').style.opacity = '1';
    
    document.querySelectorAll('#rooms-list .convo-item').forEach(el => el.style.background = 'transparent');
    if(element) element.style.background = 'var(--primary-light)';
    
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
    div.style = `max-width: 70%; padding: 12px 18px; border-radius: 20px; font-size: 0.95rem; line-height: 1.4; word-wrap: break-word; margin-bottom: 10px; ${isMe ? 'align-self: flex-end; background: var(--primary); color: white; border-bottom-right-radius: 5px;' : 'align-self: flex-start; background: white; color: var(--text-main); border-bottom-left-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);'}`;
    div.innerHTML = `<div style="font-size:0.75rem; opacity:0.7; margin-bottom:4px; font-weight:600;">${escapeHtml(msg.senderName)}</div><span>${escapeHtml(msg.text)}</span>`;
    container.appendChild(div);
}

document.getElementById('send-room-msg-btn')?.addEventListener('click', () => {
    const input = document.getElementById('room-message-input');
    const text = input.value.trim();
    if (!text || !currentRoomId) return;
    socket.emit('room_message', { roomId: currentRoomId, text });
    input.value = '';
});

// Avatar Upload
document.getElementById('profile-avatar')?.addEventListener('click', () => {
    if (document.getElementById('profile-username').innerText === currentUser.username) {
        document.getElementById('avatar-upload-input').click();
    }
});

document.getElementById('avatar-upload-input')?.addEventListener('change', async (e) => {
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

// Run Init
initApp();
