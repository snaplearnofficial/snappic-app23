// ═══════════════════════════════════════════════════
//  SNAPPIC — app.js
// ═══════════════════════════════════════════════════
const API_URL = '';
let currentUser   = null;
let currentChatUserId = null;
let currentChatUsername = null;
let currentChatAvatar   = null;
let socket = null;
let allUsersCache = {};
let unreadMessages = 0;
let unreadNotifs   = 0;
let selectedMediaBase64 = null;
let selectedMediaType   = null; // 'image' | 'video'
let editAvatarBase64    = null;
let typingTimer = null;
let isTyping = false;
let currentRoomId = null;

// ── Utilities ─────────────────────────────────────
const showToast = (msg, type = 'default') => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.background = type === 'error' ? '#ef4444' : '#1e293b';
    t.innerText = msg;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => t.remove(), 3000);
};

const formatTime = (iso) => {
    const d = new Date(iso), now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h`;
    return d.toLocaleDateString();
};

const escape = (s) => (s||'').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const avatarHtml = (a, size = 40) => {
    if (a && (a.startsWith('data:image') || a.startsWith('http')))
        return `<img src="${a}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    if (a && a.length <= 3)
        return `<span style="font-size:${Math.round(size*0.35)}px;font-weight:700;">${escape(a)}</span>`;
    return `<i class="ri-user-smile-fill"></i>`;
};

const token = () => localStorage.getItem('snappic_token');

const apiFetch = (path, opts = {}) => fetch(API_URL + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token()}`, ...(opts.headers||{}) }
});

window.showView = (id) => {
    document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.target === id);
    });
    if (id === 'chat-view')    { loadConversations(); markMsgsRead(); }
    if (id === 'profile-view') loadProfile(currentUser.id);
    if (id === 'feed-view')    loadFeed();
    if (id === 'notif-view')   loadNotifications();
};

// ── Auth ──────────────────────────────────────────
let isLoginMode = true;

document.getElementById('auth-switch-btn')?.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title-text').innerText  = isLoginMode ? 'Log in or sign up' : 'Create an account';
    document.getElementById('username-group').classList.toggle('hidden', isLoginMode);
    document.getElementById('auth-submit').innerText       = isLoginMode ? 'CONTINUE' : 'SIGN UP';
    document.getElementById('auth-switch-text').innerText  = isLoginMode ? "Don't have an account?" : 'Already have an account?';
    document.getElementById('auth-switch-btn').innerText   = isLoginMode ? 'Sign up' : 'Log in';
});

document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const username = document.getElementById('auth-username').value.trim();
    const endpoint = isLoginMode ? '/api/login' : '/api/register';
    const body     = isLoginMode ? { email, password } : { username, email, password };

    document.getElementById('auth-submit').innerText = 'Please wait...';
    try {
        const res  = await fetch(API_URL + endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }
        localStorage.setItem('snappic_token', data.token);
        initApp();
    } catch { showToast('Connection error', 'error'); }
    finally { document.getElementById('auth-submit').innerText = isLoginMode ? 'CONTINUE' : 'SIGN UP'; }
});

document.getElementById('logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('snappic_token');
    location.reload();
});

// ── Init ──────────────────────────────────────────
async function initApp() {
    if (!token()) return;
    try {
        const res  = await apiFetch('/api/me');
        const data = await res.json();
        if (data.error) { localStorage.removeItem('snappic_token'); return; }

        currentUser = data.user;
        document.getElementById('auth').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('nav-username').innerText     = currentUser.username;
        document.getElementById('header-username').innerText  = currentUser.username;
        document.getElementById('nav-avatar').innerHTML       = avatarHtml(currentUser.avatar);

        initSocket();
        loadFeed();
    } catch(e) { console.error(e); }
}

// ── Navigation ────────────────────────────────────
document.querySelectorAll('.nav-item[data-target]').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        showView(item.getAttribute('data-target'));
    });
});

// ── Feed ──────────────────────────────────────────
async function loadFeed() {
    try {
        const res  = await apiFetch('/api/posts');
        const data = await res.json();
        const c    = document.getElementById('feed-container');
        c.innerHTML = '';
        if (!data.posts?.length) {
            c.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-muted);">No posts yet — be the first!</div>';
            return;
        }
        data.posts.forEach(p => c.appendChild(createPostElement(p)));
    } catch(e) { console.error(e); }
}

function createPostElement(post) {
    const div = document.createElement('div');
    div.className = 'post-card';
    div.id = `post-${post.id}`;

    const mediaHtml = () => {
        if (post.mediaType === 'video' && post.video) {
            return `<video src="${post.video}" style="width:100%;max-height:500px;object-fit:contain;background:#000;" controls playsinline></video>`;
        }
        if (post.image) {
            return `<img src="${post.image}" style="width:100%;max-height:500px;object-fit:contain;cursor:pointer;" onclick="openImageViewer('${post.id}')">`;
        }
        return '';
    };

    const commentsHtml = (post.comments||[]).map(c => `
        <div class="comment">
            <div class="avatar" style="width:30px;height:30px;flex-shrink:0;">${avatarHtml('',30)}</div>
            <div><strong>${escape(c.username)}</strong> ${escape(c.text)}</div>
        </div>`).join('');

    div.innerHTML = `
        <div class="post-header">
            <div class="post-user" onclick="loadProfile('${post.author.id}')">
                <div class="avatar">${avatarHtml(post.author.avatar)}</div>
                <div>
                    <div class="name">@${escape(post.author.username)}</div>
                    <div class="time">${formatTime(post.createdAt)}</div>
                </div>
            </div>
            ${post.author.id === currentUser.id ? `<button class="post-opt" onclick="deletePost('${post.id}')"><i class="ri-delete-bin-line"></i></button>` : '<button class="post-opt"><i class="ri-more-2-fill"></i></button>'}
        </div>

        ${mediaHtml() ? `<div class="post-image-container" style="background:#0f172a;">${mediaHtml()}</div>` : ''}

        <div class="post-content-area">
            ${post.caption ? `<p class="post-caption">${escape(post.caption)}</p>` : ''}
            <div style="display:flex;gap:15px;margin-bottom:12px;">
                <button id="like-btn-${post.id}" onclick="toggleLike('${post.id}')" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:0.95rem;font-weight:600;color:${post.isLiked?'#ef4444':'var(--text-muted)'};">
                    <i class="${post.isLiked?'ri-heart-3-fill':'ri-heart-3-line'}" style="font-size:1.4rem;"></i>
                    <span id="like-count-${post.id}">${post.likes}</span>
                </button>
                <button onclick="toggleComments('${post.id}')" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:0.95rem;font-weight:600;color:var(--text-muted);">
                    <i class="ri-chat-3-line" style="font-size:1.4rem;"></i>
                    <span id="comment-count-${post.id}">${post.commentCount}</span>
                </button>
                <button onclick="copyLink('${post.id}')" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:0.95rem;font-weight:600;color:var(--text-muted);margin-left:auto;">
                    <i class="ri-share-forward-line" style="font-size:1.4rem;"></i>
                </button>
            </div>
            <div id="comments-section-${post.id}" class="hidden">
                <div class="post-comments" id="comments-${post.id}">
                    ${commentsHtml || '<span style="color:var(--text-muted);font-size:0.85rem;">No comments yet</span>'}
                </div>
                <div class="comment-input-area">
                    <div class="avatar" style="width:32px;height:32px;">${avatarHtml(currentUser?.avatar,32)}</div>
                    <input type="text" id="comment-input-${post.id}" placeholder="Add a comment..." onkeypress="if(event.key==='Enter')addComment('${post.id}')">
                    <button onclick="addComment('${post.id}')">Post</button>
                </div>
            </div>
        </div>`;
    return div;
}

window.toggleComments = (pid) => {
    document.getElementById(`comments-section-${pid}`)?.classList.toggle('hidden');
};

window.toggleLike = async (pid) => {
    const btn   = document.getElementById(`like-btn-${pid}`);
    const icon  = btn?.querySelector('i');
    const count = document.getElementById(`like-count-${pid}`);
    const liked = icon?.classList.contains('ri-heart-3-fill');

    // Optimistic
    if (icon) {
        icon.className = liked ? 'ri-heart-3-line' : 'ri-heart-3-fill';
        btn.style.color = liked ? 'var(--text-muted)' : '#ef4444';
        if (count) count.innerText = parseInt(count.innerText) + (liked ? -1 : 1);
    }
    try {
        await apiFetch(`/api/posts/${pid}/like`, { method:'POST' });
    } catch(e) { console.error(e); }
};

window.addComment = async (pid) => {
    const input = document.getElementById(`comment-input-${pid}`);
    const text  = input?.value.trim();
    if (!text) return;
    input.value = '';
    try {
        await apiFetch(`/api/posts/${pid}/comment`, { method:'POST', body:JSON.stringify({ text }) });
    } catch(e) { console.error(e); }
};

window.deletePost = async (pid) => {
    if (!confirm('Delete this post?')) return;
    try {
        await apiFetch(`/api/posts/${pid}`, { method:'DELETE' });
        document.getElementById(`post-${pid}`)?.remove();
        showToast('Post deleted');
    } catch(e) { showToast('Failed to delete', 'error'); }
};

window.copyLink = (pid) => {
    navigator.clipboard.writeText(window.location.origin + '?post=' + pid);
    showToast('Link copied!');
};

window.openImageViewer = (pid) => {
    const post = document.getElementById(`post-${pid}`);
    const img  = post?.querySelector('img');
    if (!img) return;
    document.getElementById('image-viewer-img').src = img.src;
    document.getElementById('image-viewer-modal').classList.add('active');
};
document.getElementById('close-image-viewer')?.addEventListener('click', () => {
    document.getElementById('image-viewer-modal').classList.remove('active');
});

// ── Create Post Modal ─────────────────────────────
const postModal = document.getElementById('create-post-modal');
document.getElementById('open-post-modal')?.addEventListener('click', () => postModal.classList.add('active'));
document.getElementById('open-post-modal-mobile')?.addEventListener('click', () => postModal.classList.add('active'));
document.getElementById('close-post-modal')?.addEventListener('click', () => { postModal.classList.remove('active'); resetPostModal(); });

const mediaInput   = document.getElementById('post-media-input');
const imgPreview   = document.getElementById('post-image-preview');
const vidPreview   = document.getElementById('post-video-preview');
const removeBtn    = document.getElementById('remove-media-btn');

document.getElementById('media-upload-area')?.addEventListener('click', (e) => {
    if (e.target.closest('#remove-media-btn')) return;
    mediaInput.click();
});

mediaInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        selectedMediaBase64 = ev.target.result;
        selectedMediaType   = file.type.startsWith('video') ? 'video' : 'image';
        if (selectedMediaType === 'video') {
            vidPreview.src = selectedMediaBase64;
            vidPreview.classList.remove('hidden');
            imgPreview.classList.add('hidden');
        } else {
            imgPreview.src = selectedMediaBase64;
            imgPreview.classList.remove('hidden');
            vidPreview.classList.add('hidden');
        }
        removeBtn.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
});

removeBtn?.addEventListener('click', (e) => { e.stopPropagation(); resetPostModal(); });

function resetPostModal() {
    selectedMediaBase64 = null;
    selectedMediaType   = null;
    imgPreview.src = ''; imgPreview.classList.add('hidden');
    vidPreview.src = ''; vidPreview.classList.add('hidden');
    removeBtn.classList.add('hidden');
    document.getElementById('post-caption').value = '';
    mediaInput.value = '';
}

document.getElementById('submit-post-btn')?.addEventListener('click', async () => {
    const caption = document.getElementById('post-caption').value.trim();
    if (!caption && !selectedMediaBase64) return showToast('Add a caption or media');
    const btn = document.getElementById('submit-post-btn');
    btn.innerText = 'Sharing...'; btn.disabled = true;
    try {
        const body = {
            caption,
            mediaType: selectedMediaType || 'text',
            ...(selectedMediaType === 'video' ? { video: selectedMediaBase64 } : {}),
            ...(selectedMediaType === 'image' ? { image: selectedMediaBase64 } : {}),
        };
        const res = await apiFetch('/api/posts', { method:'POST', body:JSON.stringify(body) });
        if (res.ok) { postModal.classList.remove('active'); resetPostModal(); showToast('Post shared!'); }
        else showToast('Failed to share', 'error');
    } catch { showToast('Failed to share', 'error'); }
    btn.innerText = 'Share Post'; btn.disabled = false;
});

// ── Search / Explore ──────────────────────────────
document.getElementById('search-input')?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const c = document.getElementById('search-results');
    if (!q) { c.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px 0;">Search for people to connect</div>'; return; }
    try {
        const res  = await apiFetch(`/api/users/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        c.innerHTML = '';
        if (!data.users?.length) { c.innerHTML = '<div style="color:var(--text-muted);padding:20px 0;">No users found</div>'; return; }
        data.users.forEach(u => {
            const div = document.createElement('div');
            div.style = 'display:flex;align-items:center;justify-content:space-between;background:white;padding:14px;border-radius:14px;margin-bottom:10px;border:1px solid var(--border);cursor:pointer;';
            div.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;" onclick="loadProfile('${u.id}')">
                    <div class="avatar" style="width:48px;height:48px;">${avatarHtml(u.avatar,48)}</div>
                    <div><strong>${escape(u.username)}</strong><div style="font-size:0.83rem;color:var(--text-muted);">${escape(u.bio||'')}</div></div>
                </div>
                <button onclick="loadProfile('${u.id}')" style="background:var(--primary-light);color:var(--primary);border:none;padding:8px 18px;border-radius:20px;font-weight:600;cursor:pointer;">View</button>`;
            c.appendChild(div);
        });
    } catch(e) { console.error(e); }
});

// ── Profile ───────────────────────────────────────
window.loadProfile = async (userId) => {
    try {
        const res  = await apiFetch(`/api/users/${userId}`);
        const data = await res.json();
        if (data.error) return showToast(data.error, 'error');
        const u = data.user;

        document.getElementById('profile-username').innerText = u.username;
        document.getElementById('profile-bio').innerText      = u.bio || '';
        document.getElementById('profile-avatar').innerHTML   = avatarHtml(u.avatar, 80);
        document.getElementById('profile-posts-count').innerText = data.posts.length;
        document.getElementById('profile-followers').innerText   = u.followers;
        document.getElementById('profile-following').innerText   = u.following;

        const actions = document.getElementById('profile-actions');
        actions.innerHTML = '';

        if (u.id === currentUser.id) {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-secondary';
            editBtn.innerHTML = '<i class="ri-edit-line"></i> Edit Profile';
            editBtn.onclick = openEditProfile;
            actions.appendChild(editBtn);
        } else {
            const followBtn = document.createElement('button');
            followBtn.className = u.isFollowing ? 'btn-secondary' : 'btn-primary';
            followBtn.innerText = u.isFollowing ? 'Following' : 'Follow';
            followBtn.onclick   = () => toggleFollow(u.id, followBtn);
            const msgBtn = document.createElement('button');
            msgBtn.className  = 'btn-secondary';
            msgBtn.innerHTML  = '<i class="ri-chat-3-line"></i> Message';
            msgBtn.onclick    = () => openChat(u.id, u.username, u.avatar);
            actions.appendChild(followBtn);
            actions.appendChild(msgBtn);
        }

        const grid = document.getElementById('profile-grid-post');
        grid.innerHTML = '';
        data.posts.forEach(p => {
            const cell = document.createElement('div');
            cell.style = 'aspect-ratio:1;background:#0f172a;border-radius:8px;overflow:hidden;position:relative;cursor:pointer;';
            if (p.mediaType === 'video' && p.video) {
                cell.innerHTML = `<video src="${p.video}" style="width:100%;height:100%;object-fit:cover;" muted></video><div style="position:absolute;top:6px;right:6px;color:white;font-size:1rem;"><i class="ri-play-circle-fill"></i></div>`;
            } else if (p.image) {
                cell.innerHTML = `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover;">`;
            } else {
                cell.innerHTML = `<div style="padding:8px;display:flex;align-items:center;height:100%;color:white;font-size:0.8rem;">${escape(p.caption)}</div>`;
            }
            grid.appendChild(cell);
        });

        showView('profile-view');
    } catch(e) { console.error(e); }
};

async function toggleFollow(userId, btn) {
    try {
        const res  = await apiFetch(`/api/users/${userId}/follow`, { method:'POST' });
        const data = await res.json();
        if (data.success) {
            btn.className = data.isFollowing ? 'btn-secondary' : 'btn-primary';
            btn.innerText = data.isFollowing ? 'Following' : 'Follow';
            document.getElementById('profile-followers').innerText = data.followers;
        }
    } catch(e) { console.error(e); }
}

// ── Edit Profile ──────────────────────────────────
function openEditProfile() {
    document.getElementById('edit-username').value        = currentUser.username;
    document.getElementById('edit-bio').value             = currentUser.bio || '';
    document.getElementById('edit-avatar-preview').innerHTML = avatarHtml(currentUser.avatar, 80);
    editAvatarBase64 = null;
    document.getElementById('edit-profile-modal').classList.add('active');
}

document.getElementById('close-edit-modal')?.addEventListener('click', () => {
    document.getElementById('edit-profile-modal').classList.remove('active');
});

document.getElementById('edit-avatar-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        editAvatarBase64 = ev.target.result;
        document.getElementById('edit-avatar-preview').innerHTML = `<img src="${editAvatarBase64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    };
    reader.readAsDataURL(file);
});

document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
    const username = document.getElementById('edit-username').value.trim();
    const bio      = document.getElementById('edit-bio').value.trim();
    const btn      = document.getElementById('save-profile-btn');
    if (!username) return showToast('Username cannot be empty', 'error');

    btn.innerText = 'Saving...'; btn.disabled = true;
    try {
        const body = { username, bio };
        if (editAvatarBase64) body.avatar = editAvatarBase64;

        const res  = await apiFetch('/api/users/me', { method:'PATCH', body:JSON.stringify(body) });
        const data = await res.json();

        if (data.error) { showToast(data.error, 'error'); return; }

        currentUser.username = data.user.username;
        currentUser.bio      = data.user.bio;
        if (data.user.avatar) currentUser.avatar = data.user.avatar;

        document.getElementById('nav-username').innerText   = currentUser.username;
        document.getElementById('nav-avatar').innerHTML     = avatarHtml(currentUser.avatar);
        document.getElementById('edit-profile-modal').classList.remove('active');
        showToast('Profile updated!');
        loadProfile(currentUser.id);
    } catch { showToast('Failed to save', 'error'); }
    btn.innerText = 'Save Changes'; btn.disabled = false;
});

// ── Notifications ─────────────────────────────────
async function loadNotifications() {
    try {
        const res  = await apiFetch('/api/notifications');
        const data = await res.json();
        const c    = document.getElementById('notif-list');
        await apiFetch('/api/notifications/read', { method:'POST' });
        unreadNotifs = 0; updateNotifBadge();

        if (!data.notifications?.length) {
            c.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px 0;">No notifications yet</div>';
            return;
        }
        c.innerHTML = '';
        data.notifications.forEach(n => {
            const div = document.createElement('div');
            div.style = 'display:flex;align-items:center;gap:12px;background:white;padding:14px;border-radius:14px;margin-bottom:10px;border:1px solid var(--border);';
            const icons = { like:'ri-heart-3-fill', comment:'ri-chat-3-fill', follow:'ri-user-add-fill', message:'ri-message-3-fill' };
            div.innerHTML = `
                <div class="avatar" style="width:44px;height:44px;">${avatarHtml(n.senderAvatar,44)}</div>
                <div style="flex:1;">
                    <strong>${escape(n.senderUsername)}</strong>
                    ${n.type==='like'?' liked your post.':n.type==='comment'?' commented on your post.':n.type==='follow'?' started following you.':' sent you a message.'}
                    <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">${formatTime(n.createdAt)}</div>
                </div>
                <i class="${icons[n.type]||'ri-notification-3-fill'}" style="font-size:1.3rem;color:var(--primary);"></i>`;
            c.appendChild(div);
        });
    } catch(e) { console.error(e); }
}

function updateNotifBadge() {
    const b = document.getElementById('notif-badge');
    const d = document.getElementById('notif-dot');
    if (b) { b.style.display = unreadNotifs > 0 ? 'block' : 'none'; b.innerText = unreadNotifs; }
    if (d) { d.style.display = unreadNotifs > 0 ? 'block' : 'none'; }
}

// ── Chat ──────────────────────────────────────────
async function loadConversations() {
    try {
        const res  = await apiFetch('/api/conversations');
        const data = await res.json();
        const list = document.getElementById('conversations-list');
        list.innerHTML = '';
        if (!data.users?.length) {
            list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.9rem;">No conversations yet</div>';
            return;
        }
        data.users.forEach(u => {
            allUsersCache[u.id] = u;
            const div = document.createElement('div');
            div.className = `convo-item${u.id === currentChatUserId ? ' active' : ''}`;
            div.style = 'display:flex;align-items:center;gap:12px;padding:14px 20px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;';
            div.onmouseenter = () => { if(u.id!==currentChatUserId) div.style.background='var(--bg-main)'; };
            div.onmouseleave = () => { if(u.id!==currentChatUserId) div.style.background=''; };
            div.onclick = () => openChat(u.id, u.username, u.avatar);
            div.innerHTML = `
                <div style="position:relative;">
                    <div class="avatar" style="width:50px;height:50px;">${avatarHtml(u.avatar,50)}</div>
                </div>
                <div style="flex:1;overflow:hidden;">
                    <div style="font-weight:700;font-size:1rem;display:flex;justify-content:space-between;align-items:center;">
                        <span>${escape(u.username)}</span>
                        ${u.unread>0?`<span style="background:var(--primary);color:white;font-size:0.75rem;padding:2px 7px;border-radius:12px;">${u.unread}</span>`:''}
                    </div>
                    <div style="font-size:0.85rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escape(u.lastMessage||'')}</div>
                </div>`;
            list.appendChild(div);
        });
    } catch(e) { console.error(e); }
}

window.openChat = async (userId, username, avatar) => {
    currentChatUserId   = userId;
    currentChatUsername = username;
    currentChatAvatar   = avatar;

    document.getElementById('chat-empty-state').classList.add('hidden');
    document.getElementById('chat-active-state').classList.remove('hidden');
    document.getElementById('chat-active-name').innerText    = username;
    document.getElementById('chat-active-avatar').innerHTML  = avatarHtml(avatar,42);
    document.getElementById('typing-indicator').style.display = 'none';

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        document.getElementById('chat-area').style.display = 'flex';
        document.getElementById('close-chat-mobile').style.display = 'flex';
    }

    showView('chat-view');
    try {
        const res  = await apiFetch(`/api/messages/${userId}`);
        const data = await res.json();
        const c    = document.getElementById('messages-container');
        c.innerHTML = '';
        (data.messages||[]).forEach(m => appendMessage(m));
        scrollToBottom();
        markMsgsRead();
    } catch(e) { console.error(e); }
};

window.viewChatUserProfile = () => {
    if (currentChatUserId) loadProfile(currentChatUserId);
};

document.getElementById('close-chat-mobile')?.addEventListener('click', () => {
    document.getElementById('chat-active-state').classList.add('hidden');
    document.getElementById('chat-empty-state').classList.remove('hidden');
    document.getElementById('close-chat-mobile').style.display = 'none';
    currentChatUserId = null;
});

document.getElementById('send-msg-btn')?.addEventListener('click', sendMessage);
document.getElementById('message-input')?.addEventListener('keypress', (e) => { if(e.key==='Enter') sendMessage(); });

document.getElementById('message-input')?.addEventListener('input', () => {
    if (!currentChatUserId) return;
    if (!isTyping) { isTyping = true; socket?.emit('typing', { receiverId: currentChatUserId }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { isTyping = false; socket?.emit('stop_typing', { receiverId: currentChatUserId }); }, 1500);
});

function sendMessage() {
    const input = document.getElementById('message-input');
    const text  = input.value.trim();
    if (!text || !currentChatUserId) return;
    socket?.emit('direct_message', { receiverId: currentChatUserId, text });
    input.value = '';
    isTyping = false;
    socket?.emit('stop_typing', { receiverId: currentChatUserId });
}

function appendMessage(msg) {
    const c    = document.getElementById('messages-container');
    const isMe = msg.senderId === currentUser.id;
    const div  = document.getElementById(`msg-${msg.id}`) || document.createElement('div');
    div.id     = `msg-${msg.id}`;
    div.style  = `max-width:70%;padding:11px 16px;border-radius:20px;font-size:0.95rem;line-height:1.4;word-wrap:break-word;align-self:${isMe?'flex-end':'flex-start'};${isMe?'background:var(--primary);color:white;border-bottom-right-radius:5px;':'background:white;color:var(--text-main);border-bottom-left-radius:5px;box-shadow:0 2px 5px rgba(0,0,0,0.06);'}`;
    div.innerHTML = `
        <span>${escape(msg.text)}</span>
        <div style="font-size:0.68rem;opacity:0.6;margin-top:4px;text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:4px;">
            ${formatTime(msg.createdAt)}
            ${isMe ? `<i class="${msg.seen?'ri-check-double-line':'ri-check-line'}" id="seen-${msg.id}" style="${msg.seen?'color:#60a5fa':''}"></i>` : ''}
        </div>`;
    if (!document.getElementById(`msg-${msg.id}`)) c.appendChild(div);
}

function scrollToBottom() {
    const c = document.getElementById('messages-container');
    if (c) c.scrollTop = c.scrollHeight;
}

function markMsgsRead() {
    unreadMessages = 0;
    document.getElementById('msg-badge').style.display = 'none';
    document.getElementById('mobile-msg-badge').style.display = 'none';
    document.getElementById('mobile-msg-dot').style.display = 'none';
}

// ── New Chat Search ───────────────────────────────
window.showUserSearch = () => {
    document.getElementById('new-chat-modal').classList.add('active');
    document.getElementById('new-chat-search').value = '';
    document.getElementById('new-chat-results').innerHTML = '';
    setTimeout(() => document.getElementById('new-chat-search').focus(), 100);
};

document.getElementById('close-new-chat-modal')?.addEventListener('click', () => {
    document.getElementById('new-chat-modal').classList.remove('active');
});

document.getElementById('new-chat-search')?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const c = document.getElementById('new-chat-results');
    if (!q) { c.innerHTML = ''; return; }
    try {
        const res  = await apiFetch(`/api/users/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        c.innerHTML = '';
        (data.users||[]).filter(u => u.id !== currentUser.id).forEach(u => {
            const div = document.createElement('div');
            div.style = 'display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;cursor:pointer;transition:background 0.15s;';
            div.onmouseenter = () => div.style.background = 'var(--bg-main)';
            div.onmouseleave = () => div.style.background = '';
            div.innerHTML = `
                <div class="avatar" style="width:44px;height:44px;">${avatarHtml(u.avatar,44)}</div>
                <div><strong>${escape(u.username)}</strong><div style="font-size:0.83rem;color:var(--text-muted);">${escape(u.bio||'')}</div></div>`;
            div.onclick = () => {
                document.getElementById('new-chat-modal').classList.remove('active');
                openChat(u.id, u.username, u.avatar);
            };
            c.appendChild(div);
        });
        if (!c.children.length) c.innerHTML = '<div style="color:var(--text-muted);padding:10px;">No users found</div>';
    } catch(e) { console.error(e); }
});

// ── Rooms ─────────────────────────────────────────
window.joinRoom = (roomId, el) => {
    currentRoomId = roomId;
    const names = { general:'General', announcements:'Announcements', random:'Random' };
    document.getElementById('room-active-name').innerText = names[roomId] || roomId;
    document.getElementById('room-messages-container').innerHTML = '';
    document.getElementById('room-active-state').style.opacity = '1';
    document.querySelectorAll('#rooms-list .convo-item').forEach(e => e.style.background = '');
    if (el) el.style.background = 'var(--primary-light)';
    socket?.emit('join_room', roomId);
};

document.getElementById('send-room-msg-btn')?.addEventListener('click', sendRoomMessage);
document.getElementById('room-message-input')?.addEventListener('keypress', (e) => { if(e.key==='Enter') sendRoomMessage(); });

function sendRoomMessage() {
    const input = document.getElementById('room-message-input');
    const text  = input.value.trim();
    if (!text || !currentRoomId) return;
    socket?.emit('room_message', { roomId: currentRoomId, text });
    input.value = '';
}

function appendRoomMessage(msg) {
    const c    = document.getElementById('room-messages-container');
    if (!c) return;
    const isMe = msg.senderId === currentUser.id;
    const div  = document.createElement('div');
    div.style  = `max-width:70%;padding:11px 16px;border-radius:20px;font-size:0.95rem;line-height:1.4;word-wrap:break-word;align-self:${isMe?'flex-end':'flex-start'};${isMe?'background:var(--primary);color:white;border-bottom-right-radius:5px;':'background:white;color:var(--text-main);border-bottom-left-radius:5px;box-shadow:0 2px 5px rgba(0,0,0,0.06);'}`;
    div.innerHTML = `${!isMe?`<div style="font-size:0.75rem;font-weight:700;opacity:0.7;margin-bottom:3px;">${escape(msg.senderName)}</div>`:''}${escape(msg.text)}`;
    c.appendChild(div);
    c.scrollTop = c.scrollHeight;
}

// ── Socket ────────────────────────────────────────
function initSocket() {
    socket = io(API_URL, { transports:['polling','websocket'] });

    socket.on('connect', () => socket.emit('user_join', { id: currentUser.id }));

    socket.on('new_post', (post) => {
        const c = document.getElementById('feed-container');
        const el = createPostElement(post);
        if (c.firstChild && !c.innerHTML.includes('No posts yet')) {
            c.insertBefore(el, c.firstChild);
        } else { c.innerHTML = ''; c.appendChild(el); }
    });

    socket.on('post_deleted', ({ postId }) => document.getElementById(`post-${postId}`)?.remove());

    socket.on('post_liked', ({ postId, likes }) => {
        const span = document.getElementById(`like-count-${postId}`);
        if (span) span.innerText = likes;
    });

    socket.on('new_comment', ({ postId, comment, commentCount }) => {
        const cc = document.getElementById(`comment-count-${postId}`);
        if (cc) cc.innerText = commentCount;
        const box = document.getElementById(`comments-${postId}`);
        if (box) {
            const d = document.createElement('div');
            d.className = 'comment';
            d.innerHTML = `<div class="avatar" style="width:30px;height:30px;flex-shrink:0;">${avatarHtml('',30)}</div><div><strong>${escape(comment.username)}</strong> ${escape(comment.text)}</div>`;
            box.appendChild(d);
            box.scrollTop = box.scrollHeight;
        }
    });

    socket.on('new_direct_message', (msg) => {
        if (msg.senderId === currentChatUserId || msg.senderId === currentUser.id) {
            appendMessage(msg);
            scrollToBottom();
            if (msg.senderId !== currentUser.id) socket.emit('message_seen', { messageId: msg.id });
        } else if (msg.senderId !== currentUser.id) {
            unreadMessages++;
            document.getElementById('msg-badge').style.display = 'block';
            document.getElementById('msg-badge').innerText = unreadMessages;
            document.getElementById('mobile-msg-badge').style.display = 'block';
            document.getElementById('mobile-msg-dot').style.display = 'block';
            showToast(`New message from ${allUsersCache[msg.senderId]?.username||'someone'}`);
            loadConversations();
        }
    });

    socket.on('message_seen', ({ messageId }) => {
        const icon = document.getElementById(`seen-${messageId}`);
        if (icon) { icon.className = 'ri-check-double-line'; icon.style.color = '#60a5fa'; }
    });

    socket.on('user_typing', ({ senderId }) => {
        if (senderId === currentChatUserId) {
            document.getElementById('typing-indicator').style.display = 'block';
        }
    });
    socket.on('user_stop_typing', ({ senderId }) => {
        if (senderId === currentChatUserId) {
            document.getElementById('typing-indicator').style.display = 'none';
        }
    });

    socket.on('room_history', (msgs) => {
        const c = document.getElementById('room-messages-container');
        if (!c) return;
        c.innerHTML = '';
        msgs.forEach(m => appendRoomMessage(m));
        c.scrollTop = c.scrollHeight;
    });

    socket.on('new_room_message', ({ roomId, msg }) => {
        if (roomId === currentRoomId) appendRoomMessage(msg);
    });

    socket.on('new_notification', (notif) => {
        unreadNotifs++;
        updateNotifBadge();
        showToast(`${notif.senderUsername} ${notif.type==='like'?'liked your post':notif.type==='comment'?'commented':notif.type==='follow'?'followed you':'sent a message'}`);
    });
}

// ── Boot ──────────────────────────────────────────
initApp();
