const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket']
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'snappic_secret_change_in_production';

if (!MONGO_URI) {
  console.error('MONGO_URI is not set. Add it to Render environment variables.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB!'))
  .catch(err => { console.error('MongoDB Error:', err.message); process.exit(1); });

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  username: { type: String, unique: true, trim: true },
  email: { type: String, unique: true, lowercase: true, trim: true },
  password: { type: String, select: false },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '' },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const postSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  authorId: String,
  caption: { type: String, default: '' },
  image: String,
  video: String,
  mediaType: { type: String, enum: ['image', 'video', 'text'], default: 'text' },
  postType: { type: String, default: 'post' },
  likes: { type: [String], default: [] },
  comments: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

const messageSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  senderId: String,
  receiverId: String,
  text: String,
  seen: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const notificationSchema = new mongoose.Schema({
  id: String,
  userId: String,
  type: String,
  senderId: String,
  senderUsername: String,
  senderAvatar: String,
  postId: String,
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

function generateId() { return Math.random().toString(36).substr(2, 9) + Date.now().toString(36); }

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ error: 'Username or email already taken' });
    const hashed = await bcryptjs.hash(password, 10);
    const user = new User({ id: generateId(), username, email, password: hashed, avatar: username.substring(0, 2).toUpperCase() });
    await user.save();
    const token = jwt.sign({ id: user.id, username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcryptjs.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: user.id, username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio, followers: user.followers, following: user.following } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/avatar', auth, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: 'Avatar required' });
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    user.avatar = avatar;
    await user.save();
    res.json({ success: true, avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/me', auth, async (req, res) => {
  try {
    const { username, bio, avatar } = req.body;
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (username && username !== user.username) {
      const taken = await User.findOne({ username });
      if (taken) return res.status(400).json({ error: 'Username already taken' });
      user.username = username.trim();
    }
    if (bio !== undefined) user.bio = bio.trim();
    if (avatar) user.avatar = avatar;
    await user.save();
    res.json({ success: true, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ users: [] });
  const users = await User.find({ username: new RegExp(q, 'i') }).limit(10);
  res.json({ users: users.map(u => ({ id: u.id, username: u.username, avatar: u.avatar, bio: u.bio })) });
});

app.get('/api/users/:id', auth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const posts = await Post.find({ authorId: user.id }).sort({ createdAt: -1 });
    res.json({
      user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio, followers: user.followers.length, following: user.following.length, isFollowing: user.followers.includes(req.user.id) },
      posts: posts.map(p => ({ id: p.id, caption: p.caption, image: p.image, video: p.video, mediaType: p.mediaType, likes: p.likes, createdAt: p.createdAt }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:id/follow', auth, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });
  const target = await User.findOne({ id: req.params.id });
  const me = await User.findOne({ id: req.user.id });
  if (!target || !me) return res.status(404).json({ error: 'User not found' });
  const idx = target.followers.indexOf(req.user.id);
  if (idx > -1) {
    target.followers.splice(idx, 1);
    const mi = me.following.indexOf(target.id);
    if (mi > -1) me.following.splice(mi, 1);
  } else {
    target.followers.push(req.user.id);
    me.following.push(target.id);
    const notif = new Notification({ id: generateId(), userId: target.id, type: 'follow', senderId: req.user.id, senderUsername: req.user.username, senderAvatar: req.user.avatar });
    await notif.save();
    const sock = userToSocket[target.id];
    if (sock) io.to(sock).emit('new_notification', notif);
  }
  await target.save(); await me.save();
  res.json({ success: true, isFollowing: target.followers.includes(req.user.id), followers: target.followers.length });
});

app.get('/api/posts', auth, async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).limit(50);
    const result = await Promise.all(posts.map(async p => {
      const author = await User.findOne({ id: p.authorId }) || { id: p.authorId, username: 'Deleted User', avatar: '' };
      return { id: p.id, author: { id: author.id, username: author.username, avatar: author.avatar }, caption: p.caption, image: p.image, video: p.video, mediaType: p.mediaType || 'text', postType: p.postType || 'post', likes: p.likes.length, isLiked: p.likes.includes(req.user.id), comments: p.comments.slice(-5), commentCount: p.comments.length, createdAt: p.createdAt };
    }));
    res.json({ posts: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts', auth, async (req, res) => {
  try {
    const { caption, image, video, mediaType, postType } = req.body;
    if (!caption && !image && !video) return res.status(400).json({ error: 'Post needs content' });
    const post = new Post({
      id: generateId(), authorId: req.user.id, caption: caption || '',
      image: image || null, video: video || null,
      mediaType: mediaType || (video ? 'video' : image ? 'image' : 'text'),
      postType: postType || 'post'
    });
    await post.save();
    const author = await User.findOne({ id: req.user.id });
    const data = { id: post.id, author: { id: author.id, username: author.username, avatar: author.avatar }, caption: post.caption, image: post.image, video: post.video, mediaType: post.mediaType, postType: post.postType, likes: 0, isLiked: false, comments: [], commentCount: 0, createdAt: post.createdAt };
    io.emit('new_post', data);
    res.json({ success: true, post: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.authorId !== req.user.id) return res.status(403).json({ error: 'Not your post' });
    await Post.deleteOne({ id: req.params.id });
    io.emit('post_deleted', { postId: post.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Not found' });
    const idx = post.likes.indexOf(req.user.id);
    let liked;
    if (idx > -1) { post.likes.splice(idx, 1); liked = false; }
    else {
      post.likes.push(req.user.id); liked = true;
      if (post.authorId !== req.user.id) {
        const notif = new Notification({ id: generateId(), userId: post.authorId, type: 'like', senderId: req.user.id, senderUsername: req.user.username, senderAvatar: req.user.avatar, postId: post.id });
        await notif.save();
        const sock = userToSocket[post.authorId];
        if (sock) io.to(sock).emit('new_notification', notif);
      }
    }
    await post.save();
    io.emit('post_liked', { postId: post.id, likes: post.likes.length, liked });
    res.json({ success: true, liked, likes: post.likes.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts/:id/comment', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Not found' });
    const comment = { id: generateId(), username: req.user.username, text, createdAt: new Date().toISOString() };
    post.comments.push(comment);
    await post.save();
    if (post.authorId !== req.user.id) {
      const notif = new Notification({ id: generateId(), userId: post.authorId, type: 'comment', senderId: req.user.id, senderUsername: req.user.username, senderAvatar: req.user.avatar, postId: post.id });
      await notif.save();
      const sock = userToSocket[post.authorId];
      if (sock) io.to(sock).emit('new_notification', notif);
    }
    io.emit('new_comment', { postId: post.id, comment, commentCount: post.comments.length });
    res.json({ success: true, comment });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
    res.json({ notifications });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notifications/read', auth, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id }, { read: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:userId', auth, async (req, res) => {
  const msgs = await Message.find({ $or: [{ senderId: req.user.id, receiverId: req.params.userId }, { senderId: req.params.userId, receiverId: req.user.id }] }).sort({ createdAt: 1 });
  await Message.updateMany({ senderId: req.params.userId, receiverId: req.user.id, seen: false }, { seen: true });
  res.json({ messages: msgs });
});

app.get('/api/conversations', auth, async (req, res) => {
  const messages = await Message.find({ $or: [{ senderId: req.user.id }, { receiverId: req.user.id }] }).sort({ createdAt: -1 });
  const userIds = new Set();
  messages.forEach(m => {
    if (m.senderId !== req.user.id) userIds.add(m.senderId);
    if (m.receiverId !== req.user.id) userIds.add(m.receiverId);
  });
  const users = await User.find({ id: { $in: Array.from(userIds) } });
  const result = await Promise.all(users.map(async u => {
    const lastMsg = messages.find(m => m.senderId === u.id || m.receiverId === u.id);
    const unread = await Message.countDocuments({ senderId: u.id, receiverId: req.user.id, seen: false });
    return { id: u.id, username: u.username, avatar: u.avatar, lastMessage: lastMsg ? lastMsg.text : '', unread };
  }));
  res.json({ users: result });
});

const socketToUser = {};
const userToSocket = {};

io.on('connection', (socket) => {
  socket.on('user_join', ({ id }) => {
    socketToUser[socket.id] = id;
    userToSocket[id] = socket.id;
    io.emit('online_count', Object.keys(userToSocket).length);
  });

  socket.on('typing', ({ receiverId }) => {
    const sock = userToSocket[receiverId];
    if (sock) io.to(sock).emit('user_typing', { senderId: socketToUser[socket.id] });
  });

  socket.on('stop_typing', ({ receiverId }) => {
    const sock = userToSocket[receiverId];
    if (sock) io.to(sock).emit('user_stop_typing', { senderId: socketToUser[socket.id] });
  });

  socket.on('direct_message', async ({ receiverId, text }) => {
    const senderId = socketToUser[socket.id];
    if (!senderId || !receiverId || !text) return;
    const msg = new Message({ id: generateId(), senderId, receiverId, text });
    await msg.save();
    const msgData = { id: msg.id, senderId, receiverId, text, seen: false, createdAt: msg.createdAt };
    socket.emit('new_direct_message', msgData);
    const receiverSocketId = userToSocket[receiverId];
    if (receiverSocketId) io.to(receiverSocketId).emit('new_direct_message', msgData);
    const sender = await User.findOne({ id: senderId });
    if (sender) {
      const notif = new Notification({ id: generateId(), userId: receiverId, type: 'message', senderId, senderUsername: sender.username, senderAvatar: sender.avatar });
      await notif.save();
      if (receiverSocketId) io.to(receiverSocketId).emit('new_notification', notif);
    }
  });

  socket.on('message_seen', async ({ messageId }) => {
    await Message.findOneAndUpdate({ id: messageId }, { seen: true });
    const msg = await Message.findOne({ id: messageId });
    if (msg) {
      const senderSocket = userToSocket[msg.senderId];
      if (senderSocket) io.to(senderSocket).emit('message_seen', { messageId });
    }
  });

  const roomMessages = { general: [], announcements: [], random: [] };

  socket.on('join_room', (roomId) => {
    Object.keys(roomMessages).forEach(r => socket.leave(r));
    socket.join(roomId);
    socket.emit('room_history', roomMessages[roomId] || []);
  });

  socket.on('room_message', async ({ roomId, text }) => {
    const senderId = socketToUser[socket.id];
    if (!senderId || !roomId || !text) return;
    const sender = await User.findOne({ id: senderId });
    if (!sender) return;
    const msg = { id: generateId(), senderId, senderName: sender.username, senderAvatar: sender.avatar, text, createdAt: new Date().toISOString() };
    if (!roomMessages[roomId]) roomMessages[roomId] = [];
    roomMessages[roomId].push(msg);
    if (roomMessages[roomId].length > 100) roomMessages[roomId].shift();
    io.to(roomId).emit('new_room_message', { roomId, msg });
  });

  socket.on('disconnect', () => {
    const userId = socketToUser[socket.id];
    if (userId) delete userToSocket[userId];
    delete socketToUser[socket.id];
    io.emit('online_count', Object.keys(userToSocket).length);
  });
});

app.use((req, res) => { res.sendFile(path.join(publicPath, 'index.html')); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Snappic running on port ${PORT}`));
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket']
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'snappic_secret_change_in_production';

if (!MONGO_URI) {
  console.error('MONGO_URI is not set. Add it to Render environment variables.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB!'))
  .catch(err => { console.error('MongoDB Error:', err.message); process.exit(1); });

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  username: { type: String, unique: true, trim: true },
  email: { type: String, unique: true, lowercase: true, trim: true },
  password: { type: String, select: false },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '' },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const postSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  authorId: String,
  caption: { type: String, default: '' },
  image: String,
  video: String,
  mediaType: { type: String, enum: ['image', 'video', 'text'], default: 'text' },
  postType: { type: String, default: 'post' },
  likes: { type: [String], default: [] },
  comments: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

const messageSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  senderId: String,
  receiverId: String,
  text: String,
  seen: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const notificationSchema = new mongoose.Schema({
  id: String,
  userId: String,
  type: String,
  senderId: String,
  senderUsername: String,
  senderAvatar: String,
  postId: String,
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

function generateId() { return Math.random().toString(36).substr(2, 9) + Date.now().toString(36); }

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) return res.status(400).json({ error: 'Username or email already taken' });
    const hashed = await bcryptjs.hash(password, 10);
    const user = new User({ id: generateId(), username, email, password: hashed, avatar: username.substring(0, 2).toUpperCase() });
    await user.save();
    const token = jwt.sign({ id: user.id, username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcryptjs.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: user.id, username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio, followers: user.followers, following: user.following } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/avatar', auth, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: 'Avatar required' });
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    user.avatar = avatar;
    await user.save();
    res.json({ success: true, avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/me', auth, async (req, res) => {
  try {
    const { username, bio, avatar } = req.body;
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (username && username !== user.username) {
      const taken = await User.findOne({ username });
      if (taken) return res.status(400).json({ error: 'Username already taken' });
      user.username = username.trim();
    }
    if (bio !== undefined) user.bio = bio.trim();
    if (avatar) user.avatar = avatar;
    await user.save();
    res.json({ success: true, user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ users: [] });
  const users = await User.find({ username: new RegExp(q, 'i') }).limit(10);
  res.json({ users: users.map(u => ({ id: u.id, username: u.username, avatar: u.avatar, bio: u.bio })) });
});

app.get('/api/users/:id', auth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const posts = await Post.find({ authorId: user.id }).sort({ createdAt: -1 });
    res.json({
      user: { id: user.id, username: user.username, avatar: user.avatar, bio: user.bio, followers: user.followers.length, following: user.following.length, isFollowing: user.followers.includes(req.user.id) },
      posts: posts.map(p => ({ id: p.id, caption: p.caption, image: p.image, video: p.video, mediaType: p.mediaType, likes: p.likes, createdAt: p.createdAt }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/:id/follow', auth, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });
  const target = await User.findOne({ id: req.params.id });
  const me = await User.findOne({ id: req.user.id });
  if (!target || !me) return res.status(404).json({ error: 'User not found' });
  const idx = target.followers.indexOf(req.user.id);
  if (idx > -1) {
    target.followers.splice(idx, 1);
    const mi = me.following.indexOf(target.id);
    if (mi > -1) me.following.splice(mi, 1);
  } else {
    target.followers.push(req.user.id);
    me.following.push(target.id);
    const notif = new Notification({ id: generateId(), userId: target.id, type: 'follow', senderId: req.user.id, senderUsername: req.user.username, senderAvatar: req.user.avatar });
    await notif.save();
    const sock = userToSocket[target.id];
    if (sock) io.to(sock).emit('new_notification', notif);
  }
  await target.save(); await me.save();
  res.json({ success: true, isFollowing: target.followers.includes(req.user.id), followers: target.followers.length });
});

app.get('/api/posts', auth, async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).limit(50);
    const result = await Promise.all(posts.map(async p => {
      const author = await User.findOne({ id: p.authorId }) || { id: p.authorId, username: 'Deleted User', avatar: '' };
      return { id: p.id, author: { id: author.id, username: author.username, avatar: author.avatar }, caption: p.caption, image: p.image, video: p.video, mediaType: p.mediaType || 'text', postType: p.postType || 'post', likes: p.likes.length, isLiked: p.likes.includes(req.user.id), comments: p.comments.slice(-5), commentCount: p.comments.length, createdAt: p.createdAt };
    }));
    res.json({ posts: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts', auth, async (req, res) => {
  try {
    const { caption, image, video, mediaType, postType } = req.body;
    if (!caption && !image && !video) return res.status(400).json({ error: 'Post needs content' });
    const post = new Post({
      id: generateId(), authorId: req.user.id, caption: caption || '',
      image: image || null, video: video || null,
      mediaType: mediaType || (video ? 'video' : image ? 'image' : 'text'),
      postType: postType || 'post'
    });
    await post.save();
    const author = await User.findOne({ id: req.user.id });
    const data = { id: post.id, author: { id: author.id, username: author.username, avatar: author.avatar }, caption: post.caption, image: post.image, video: post.video, mediaType: post.mediaType, postType: post.postType, likes: 0, isLiked: false, comments: [], commentCount: 0, createdAt: post.createdAt };
    io.emit('new_post', data);
    res.json({ success: true, post: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.authorId !== req.user.id) return res.status(403).json({ error: 'Not your post' });
    await Post.deleteOne({ id: req.params.id });
    io.emit('post_deleted', { postId: post.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Not found' });
    const idx = post.likes.indexOf(req.user.id);
    let liked;
    if (idx > -1) { post.likes.splice(idx, 1); liked = false; }
    else {
      post.likes.push(req.user.id); liked = true;
      if (post.authorId !== req.user.id) {
        const notif = new Notification({ id: generateId(), userId: post.authorId, type: 'like', senderId: req.user.id, senderUsername: req.user.username, senderAvatar: req.user.avatar, postId: post.id });
        await notif.save();
        const sock = userToSocket[post.authorId];
        if (sock) io.to(sock).emit('new_notification', notif);
      }
    }
    await post.save();
    io.emit('post_liked', { postId: post.id, likes: post.likes.length, liked });
    res.json({ success: true, liked, likes: post.likes.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts/:id/comment', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Not found' });
    const comment = { id: generateId(), username: req.user.username, text, createdAt: new Date().toISOString() };
    post.comments.push(comment);
    await post.save();
    if (post.authorId !== req.user.id) {
      const notif = new Notification({ id: generateId(), userId: post.authorId, type: 'comment', senderId: req.user.id, senderUsername: req.user.username, senderAvatar: req.user.avatar, postId: post.id });
      await notif.save();
      const sock = userToSocket[post.authorId];
      if (sock) io.to(sock).emit('new_notification', notif);
    }
    io.emit('new_comment', { postId: post.id, comment, commentCount: post.comments.length });
    res.json({ success: true, comment });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
    res.json({ notifications });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notifications/read', auth, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id }, { read: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/messages/:userId', auth, async (req, res) => {
  const msgs = await Message.find({ $or: [{ senderId: req.user.id, receiverId: req.params.userId }, { senderId: req.params.userId, receiverId: req.user.id }] }).sort({ createdAt: 1 });
  await Message.updateMany({ senderId: req.params.userId, receiverId: req.user.id, seen: false }, { seen: true });
  res.json({ messages: msgs });
});

app.get('/api/conversations', auth, async (req, res) => {
  const messages = await Message.find({ $or: [{ senderId: req.user.id }, { receiverId: req.user.id }] }).sort({ createdAt: -1 });
  const userIds = new Set();
  messages.forEach(m => {
    if (m.senderId !== req.user.id) userIds.add(m.senderId);
    if (m.receiverId !== req.user.id) userIds.add(m.receiverId);
  });
  const users = await User.find({ id: { $in: Array.from(userIds) } });
  const result = await Promise.all(users.map(async u => {
    const lastMsg = messages.find(m => m.senderId === u.id || m.receiverId === u.id);
    const unread = await Message.countDocuments({ senderId: u.id, receiverId: req.user.id, seen: false });
    return { id: u.id, username: u.username, avatar: u.avatar, lastMessage: lastMsg ? lastMsg.text : '', unread };
  }));
  res.json({ users: result });
});

const socketToUser = {};
const userToSocket = {};

io.on('connection', (socket) => {
  socket.on('user_join', ({ id }) => {
    socketToUser[socket.id] = id;
    userToSocket[id] = socket.id;
    io.emit('online_count', Object.keys(userToSocket).length);
  });

  socket.on('typing', ({ receiverId }) => {
    const sock = userToSocket[receiverId];
    if (sock) io.to(sock).emit('user_typing', { senderId: socketToUser[socket.id] });
  });

  socket.on('stop_typing', ({ receiverId }) => {
    const sock = userToSocket[receiverId];
    if (sock) io.to(sock).emit('user_stop_typing', { senderId: socketToUser[socket.id] });
  });

  socket.on('direct_message', async ({ receiverId, text }) => {
    const senderId = socketToUser[socket.id];
    if (!senderId || !receiverId || !text) return;
    const msg = new Message({ id: generateId(), senderId, receiverId, text });
    await msg.save();
    const msgData = { id: msg.id, senderId, receiverId, text, seen: false, createdAt: msg.createdAt };
    socket.emit('new_direct_message', msgData);
    const receiverSocketId = userToSocket[receiverId];
    if (receiverSocketId) io.to(receiverSocketId).emit('new_direct_message', msgData);
    const sender = await User.findOne({ id: senderId });
    if (sender) {
      const notif = new Notification({ id: generateId(), userId: receiverId, type: 'message', senderId, senderUsername: sender.username, senderAvatar: sender.avatar });
      await notif.save();
      if (receiverSocketId) io.to(receiverSocketId).emit('new_notification', notif);
    }
  });

  socket.on('message_seen', async ({ messageId }) => {
    await Message.findOneAndUpdate({ id: messageId }, { seen: true });
    const msg = await Message.findOne({ id: messageId });
    if (msg) {
      const senderSocket = userToSocket[msg.senderId];
      if (senderSocket) io.to(senderSocket).emit('message_seen', { messageId });
    }
  });

  const roomMessages = { general: [], announcements: [], random: [] };

  socket.on('join_room', (roomId) => {
    Object.keys(roomMessages).forEach(r => socket.leave(r));
    socket.join(roomId);
    socket.emit('room_history', roomMessages[roomId] || []);
  }); 

  socket.on('room_message', async ({ roomId, text }) => {
    const senderId = socketToUser[socket.id];
    if (!senderId || !roomId || !text) return;
    const sender = await User.findOne({ id: senderId });
    if (!sender) return;
    const msg = { id: generateId(), senderId, senderName: sender.username, senderAvatar: sender.avatar, text, createdAt: new Date().toISOString() };
    if (!roomMessages[roomId]) roomMessages[roomId] = [];
    roomMessages[roomId].push(msg);
    if (roomMessages[roomId].length > 100) roomMessages[roomId].shift();
    io.to(roomId).emit('new_room_message', { roomId, msg });
  });

  socket.on('disconnect', () => {
    const userId = socketToUser[socket.id];
    if (userId) delete userToSocket[userId];
    delete socketToUser[socket.id];
    io.emit('online_count', Object.keys(userToSocket).length);
  });
});

app.use((req, res) => { res.sendFile(path.join(publicPath, 'index.html')); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Snappic running on port ${PORT}`));
