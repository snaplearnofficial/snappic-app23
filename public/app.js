const socket = io();
let currentUser = null;
let token = localStorage.getItem('snappic_token');
let currentPosts = [];
let activeChatId = null;
let profileUserId = null;

// ── Helpers ──
function toast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

async function api(url, method = 'GET', body = null) {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : null });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    return d;
}

// ── Auth ──
function toggleAuth() {
    document.getElementById('login-card').classList.toggle('hidden');
    document.getElementById('signup-card').classList.toggle('hidden');
}

async function handleLogin() {
    try {
        const email = document.getElementById('l-email').value;
        const password = document.getElementById('l-pass').value;
        if (!email || !password) { document.getElementById('login-err').innerText = 'Please fill in all fields'; return; }
        const d = await api('/api/login', 'POST', { email, password });
        token = d.token;
        localStorage.setItem('snappic_token', token);
        startApp();
    } catch (e) { document.getElementById('login-err').innerText = e.message; }
}

async function handleSignup() {
    try {
        const username = document.getElementById('s-user').value;
        const email = document.getElementById('s-email').value;
        const password = document.getElementById('s-pass').value;
        if (!username || !email || !password) { document.getElementById('signup-err').innerText = 'Please fill in all fields'; return; }
        const d = await api('/api/register', 'POST', { username, email, password });
        token = d.token;
        localStorage.setItem('snappic_token', token);
        startApp();
    } catch (e) { document.getElementById('signup-err').innerText = e.message; }
}

function handleLogout() {
    token = null;
    localStorage.removeItem('snappic_token');
    location.reload();
}

// ── App Init ──
async function startApp() {
    if (!token) return;
    try {
        const d = await api('/api/me');
        currentUser = d.user;
        document.getElementById('auth-page').style.display = 'none';
        document.getElementById('app-page').style.display = 'block';
        socket.emit('user_join', { id: currentUser.id });
        updateSidebar();
        loadStories();
        loadFeed();
    } catch (e) { handleLogout(); }
}

function updateSidebar() {
    document.getElementById('creator-av').innerText = currentUser.avatar;
    document.getElementById('side-av').innerText = currentUser.avatar;
    document.getElementById('side-un').innerText = currentUser.username;
    document.getElementById('side-name').innerText = currentUser.username;
}

// ── Stories ──
function loadStories() {
    const bar = document.getElementById('stories-bar');
    const items = [
        { name: 'Your story', av: currentUser.avatar, seen: false },
        { name: 'explore', av: '🌎', seen: false },
        { name: 'trending', av: '🔥', seen: false },
        { name: 'music', av: '🎵', seen: true },
        { name: 'food', av: '🍕', seen: true },
        { name: 'travel', av: '✈️', seen: true }
    ];
    bar.innerHTML = items.map(s => `
        <div class="story-item" onclick="toast('Stories coming soon!')">
            <div class="story-ring ${s.seen ? 'seen' : ''}"><div class="story-av">${s.av}</div></div>
            <div class="story-name">${s.name}</div>
        </div>
    `).join('');
}

// ── Feed ──
async function loadFeed() {
    const feed = document.getElementById('feed');
    feed.innerHTML = '<div class="feed-spinner"><i class="bx bx-loader-alt"></i></div>';
    try {
        const d = await api('/api/posts');
        currentPosts = d.posts;
        renderFeed();
    } catch (e) {
        feed.innerHTML = '<div class="feed-empty"><i class="bx bx-error-circle"></i><p>Could not load feed</p></div>';
    }
}

function renderFeed() {
    const feed = document.getElementById('feed');
    if (currentPosts.length === 0) {
        feed.innerHTML = '<div class="feed-empty"><i class="bx bx-camera"></i><p>No posts yet. Be the first to share!</p></div>';
        return;
    }
    feed.innerHTML = currentPosts.map(p => `
        <article class="post">
            <div class="post-header">
                <div class="post-user" onclick="viewProfile('${p.author.id}')">
                    <div class="av">${p.author.avatar}</div>
                    <span class="username">${p.author.username}</span>
                </div>
                <i class='bx bx-dots-horizontal-rounded post-more'></i>
            </div>
            ${p.image ? `<img src="${p.image}" class="post-img" loading="lazy" ondblclick="likePost('${p.id}')">` : ''}
            <div class="post-actions">
                <i class='bx ${p.isLiked ? 'bxs-heart liked' : 'bx-heart'} action-btn' onclick="likePost('${p.id}')"></i>
                <i class='bx bx-message-rounded action-btn' onclick="document.getElementById('ci-${p.id}').focus()"></i>
                <i class='bx bx-paper-plane action-btn' onclick="startChat('${p.author.id}')"></i>
                <i class='bx bx-bookmark action-btn bookmarks' onclick="toast('Saved!')"></i>
            </div>
            <div class="post-likes">${p.likes} likes</div>
            ${p.caption ? `<div class="post-cap"><span onclick="viewProfile('${p.author.id}')">${p.author.username}</span>${escapeHtml(p.caption)}</div>` : ''}
            ${p.commentCount > 0 ? `<div class="post-view-cmts">View all ${p.commentCount} comments</div>` : ''}
            <div class="post-cmt-bar">
                <input type="text" id="ci-${p.id}" placeholder="Add a comment..." onkeypress="if(event.key==='Enter')addComment('${p.id}')">
                <button class="post-btn" onclick="addComment('${p.id}')">Post</button>
            </div>
        </article>
    `).join('');
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.innerText = text;
    return d.innerHTML;
}

// ── Post Actions ──
async function likePost(id) {
    try {
        const d = await api('/api/posts/' + id + '/like', 'POST');
        const p = currentPosts.find(x => x.id === id);
        if (p) { p.isLiked = d.liked; p.likes = d.likes; renderFeed(); }
    } catch (e) { console.error(e); }
}

async function addComment(id) {
    const inp = document.getElementById('ci-' + id);
    const text = inp.value.trim();
    if (!text) return;
    try {
        await api('/api/posts/' + id + '/comment', 'POST', { text });
        inp.value = '';
        loadFeed();
    } catch (e) { console.error(e); }
}

// ── Create Post ──
function openCreate() {
    document.getElementById('create-modal').classList.add('show');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}

function previewFile(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.getElementById('create-preview');
            img.src = e.target.result;
            img.style.display = 'block';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function doPost() {
    const caption = document.getElementById('create-caption').value.trim();
    const file = document.getElementById('create-file').files[0];
    const btn = document.getElementById('share-btn');

    if (!caption && !file) return;
    btn.disabled = true;
    btn.innerText = 'Sharing...';

    let image = null;
    if (file) {
        image = await new Promise(function(resolve) {
            const r = new FileReader();
            r.onload = function() { resolve(r.result); };
            r.readAsDataURL(file);
        });
    }

    try {
        await api('/api/posts', 'POST', { caption: caption, image: image });
        closeModal('create-modal');
        document.getElementById('create-caption').value = '';
        document.getElementById('create-file').value = '';
        document.getElementById('create-preview').style.display = 'none';
        toast('Posted!');
        loadFeed();
    } catch (e) { toast(e.message); }
    btn.disabled = false;
    btn.innerText = 'Share';
}

// ── Search ──
let searchTimer;
function doSearch(q) {
    clearTimeout(searchTimer);
    const drop = document.getElementById('search-drop');
    if (!q.trim()) { drop.style.display = 'none'; return; }
    searchTimer = setTimeout(async function() {
        try {
            const d = await api('/api/users/search?q=' + encodeURIComponent(q));
            if (d.users.length > 0) {
                drop.innerHTML = d.users.map(function(u) {
                    return '<div class="search-item" onclick="viewProfile(\'' + u.id + '\')"><div class="av">' + u.avatar + '</div><span class="username">' + u.username + '</span></div>';
                }).join('');
                drop.style.display = 'block';
            } else { drop.style.display = 'none'; }
        } catch (e) { drop.style.display = 'none'; }
    }, 300);
}

// ── Profile ──
async function viewProfile(uid) {
    document.getElementById('search-drop').style.display = 'none';
    document.getElementById('search-inp').value = '';
    try {
        const d = await api('/api/users/' + uid);
        const u = d.user;
        profileUserId = uid;

        document.getElementById('prof-modal-un').innerText = u.username;
        document.getElementById('p-un').innerText = u.username;
        document.getElementById('p-av').innerText = u.avatar;
        document.getElementById('p-posts').innerText = d.posts.length;
        document.getElementById('p-followers').innerText = u.followers;
        document.getElementById('p-following').innerText = u.following;

        const fBtn = document.getElementById('p-follow-btn');
        const mBtn = document.getElementById('p-msg-btn');

        if (u.id === currentUser.id) {
            fBtn.innerText = 'Edit Profile';
            fBtn.className = 'prof-btn';
            fBtn.onclick = function() { toast('Edit profile coming soon!'); };
            mBtn.style.display = 'none';
        } else {
            mBtn.style.display = 'inline-block';
            fBtn.innerText = u.isFollowing ? 'Following' : 'Follow';
            fBtn.className = u.isFollowing ? 'prof-btn' : 'prof-btn primary';
            fBtn.onclick = function() { doFollow(u.id); };
            mBtn.onclick = function() { startChat(u.id); };
        }

        var grid = document.getElementById('prof-grid');
        grid.innerHTML = d.posts.map(function(p) {
            if (p.image) {
                return '<div class="prof-post"><img src="' + p.image + '"></div>';
            } else {
                return '<div class="prof-post"><div class="prof-post-text">' + (p.caption || '').substring(0, 60) + '</div></div>';
            }
        }).join('');

        document.getElementById('prof-modal').classList.add('show');
    } catch (e) { toast('Could not load profile'); }
}

async function doFollow(uid) {
    try {
        await api('/api/users/' + uid + '/follow', 'POST');
        viewProfile(uid);
    } catch (e) { console.error(e); }
}

function openMyProfile() {
    if (currentUser) viewProfile(currentUser.id);
}

// ── Messenger ──
async function openMsgs() {
    document.getElementById('msg-modal').classList.add('show');
    document.getElementById('msg-dot').style.display = 'none';
    try {
        const d = await api('/api/conversations');
        var list = document.getElementById('conv-list');
        if (d.users.length === 0) {
            list.innerHTML = '<div style="padding:20px; text-align:center; color:var(--muted); font-size:12px;">No conversations yet</div>';
        } else {
            list.innerHTML = d.users.map(function(u) {
                return '<div class="conv-item' + (activeChatId === u.id ? ' active' : '') + '" onclick="selectChat(\'' + u.id + '\',\'' + u.username + '\')"><div class="av">' + u.avatar + '</div><div class="conv-name">' + u.username + '</div></div>';
            }).join('');
        }
    } catch (e) { console.error(e); }
}

async function selectChat(uid, name) {
    activeChatId = uid;
    document.getElementById('msg-header').innerText = name;
    document.getElementById('msg-input-bar').classList.remove('hidden');
    try {
        const d = await api('/api/messages/' + uid);
        var body = document.getElementById('msg-body');
        if (d.messages.length === 0) {
            body.innerHTML = '<div class="msg-empty"><i class="bx bx-message-square-dots"></i><p style="font-size:13px">Say hi to ' + name + '!</p></div>';
        } else {
            body.innerHTML = d.messages.map(function(m) {
                return '<div class="bubble ' + (m.senderId === currentUser.id ? 'mine' : 'theirs') + '">' + escapeHtml(m.text) + '</div>';
            }).join('');
        }
        body.scrollTop = body.scrollHeight;
    } catch (e) { console.error(e); }
}

function sendDM() {
    var inp = document.getElementById('msg-text');
    var text = inp.value.trim();
    if (!text || !activeChatId) return;
    socket.emit('direct_message', { receiverId: activeChatId, text: text });
    inp.value = '';
}

function startChat(uid) {
    closeModal('prof-modal');
    activeChatId = uid;
    openMsgs().then(function() {
        api('/api/users/' + uid).then(function(d) {
            selectChat(uid, d.user.username);
        });
    });
}

function doMsgProfile() {
    if (profileUserId) startChat(profileUserId);
}

// ── Socket Events ──
socket.on('new_post', function(p) {
    currentPosts.unshift(p);
    renderFeed();
});

socket.on('post_liked', function(data) {
    var p = currentPosts.find(function(x) { return x.id === data.postId; });
    if (p) { p.likes = data.likes; renderFeed(); }
});

socket.on('new_comment', function(data) {
    var p = currentPosts.find(function(x) { return x.id === data.postId; });
    if (p) { p.comments.push(data.comment); p.commentCount = data.commentCount; renderFeed(); }
});

socket.on('new_direct_message', function(msg) {
    var other = msg.senderId === currentUser.id ? msg.receiverId : msg.senderId;
    if (activeChatId === other) {
        var body = document.getElementById('msg-body');
        var div = document.createElement('div');
        div.className = 'bubble ' + (msg.senderId === currentUser.id ? 'mine' : 'theirs');
        div.innerText = msg.text;
        body.appendChild(div);
        body.scrollTop = body.scrollHeight;
    } else {
        document.getElementById('msg-dot').style.display = 'block';
        toast('New message received!');
    }
});

// ── Start ──
startApp();
