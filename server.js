const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket']
});

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ultimate Path Finder
let publicPath = path.join(__dirname, 'public');
if (!fs.existsSync(path.join(publicPath, 'index.html'))) {
    publicPath = path.join(__dirname, 'snappic-live', 'public');
}
if (!fs.existsSync(path.join(publicPath, 'index.html'))) {
    console.log("❌ CRITICAL ERROR: index.html not found anywhere!");
    console.log("Current Dir:", __dirname);
    console.log("Files here:", fs.readdirSync(__dirname));
}

app.use(express.static(publicPath));

// ─── DATABASE (MONGODB) ──────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI || MONGO_URI.includes('your_mongodb')) {
  console.log('\n⚠️  WARNING: MONGO_URI is not set or using placeholder.');
  console.log('Please update the .env file with your MongoDB Atlas connection string.\n');
}

mongoose.connect(MONGO_URI || 'mongodb://127.0.0.1:27017/snappic')
  .then(() => console.log('✅ Connected to MongoDB Atlas!'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error. Make sure your IP is whitelisted on MongoDB Atlas.');
    console.error(err.message);
  });

// Schemas
const userSchema = new mongoose.Schema({
  id: String,
  username: { type: String, unique: true },
  email: { type: String, unique: true },
  password: { type: String, select: false },
  avatar: String,
  bio: { type: String, default: '' },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const postSchema = new mongoose.Schema({
  id: String,
  authorId: String,
  caption: String,
  image: String,
  likes: { type: [String], default: [] },
  comments: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', postSchema);

const messageSchema = new mongoose.Schema({
  id: String,
  senderId: String,
  receiverId: String,
  text: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Utils
function generateId() { return Math.random().toString(36).substr(2, 9) + Date.now().toString(36); }
const JWT_SECRET = process.env.JWT_SECRET || 'snappic_premium_secret_2024';

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { 
    req.user = jwt.verify(token, JWT_SECRET); 
    next(); 
  } catch { 
    res.status(401).json({ error: 'Invalid token' }); 
  }
};

// ─── AUTH ROUTES ──────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) return res.status(400).json({ error: 'Username or email already taken' });
    
    const hashed = await bcryptjs.hash(password, 10);
    const initials = username.substring(0, 2).toUpperCase();
    
    const user = new User({ 
      id: generateId(), 
      username, 
      email, 
      password: hashed, 
      avatar: initials 
    });
    
    await user.save();
    
    const token = jwt.sign({ id: user.id, username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcryptjs.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid email or password' });
    
    const token = jwt.sign({ id: user.id, username: user.username, avatar: user.avatar }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── USER & SOCIAL ROUTES ─────────────────────────────
app.get('/api/users/search', auth, async (req, res) => {
  const { q } = req.query;
  const users = await User.find({ username: new RegExp(q, 'i') }).limit(10);
  res.json({ users: users.map(u => ({ id: u.id, username: u.username, avatar: u.avatar })) });
});

app.get('/api/users/:id', auth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const posts = await Post.find({ authorId: user.id }).sort({ createdAt: -1 });
    res.json({ 
      user: { 
        id: user.id, 
        username: user.username, 
        avatar: user.avatar, 
        bio: user.bio, 
        followers: user.followers.length, 
        following: user.following.length, 
        isFollowing: user.followers.includes(req.user.id) 
      },
      posts 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users/:id/follow', auth, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot follow self' });
  const target = await User.findOne({ id: req.params.id });
  const me = await User.findOne({ id: req.user.id });
  if (!target || !me) return res.status(404).json({ error: 'User not found' });

  const idx = target.followers.indexOf(req.user.id);
  if (idx > -1) {
    target.followers.splice(idx, 1);
    me.following.splice(me.following.indexOf(target.id), 1);
  } else {
    target.followers.push(req.user.id);
    me.following.push(target.id);
  }
  await target.save(); await me.save();
  res.json({ success: true, isFollowing: target.followers.includes(req.user.id), followers: target.followers.length });
});

// ─── POST ROUTES ──────────────────────────────────────
app.get('/api/posts', auth, async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).limit(50);
    const result = await Promise.all(posts.map(async p => {
      const author = await User.findOne({ id: p.authorId }) || { id: p.authorId, username: 'Unknown', avatar: '?' };
      return {
        id: p.id, 
        author: { id: author.id, username: author.username, avatar: author.avatar },
        caption: p.caption, 
        image: p.image, 
        likes: p.likes.length,
        isLiked: p.likes.includes(req.user.id),
        comments: p.comments.slice(-5),
        commentCount: p.comments.length, 
        createdAt: p.createdAt
      };
    }));
    res.json({ posts: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts', auth, async (req, res) => {
  try {
    const { caption, image } = req.body;
    const post = new Post({ id: generateId(), authorId: req.user.id, caption, image: image || null });
    await post.save();
    
    const author = await User.findOne({ id: req.user.id });
    const data = { 
      id: post.id, 
      author: { id: author.id, username: author.username, avatar: author.avatar }, 
      caption: post.caption, 
      image: post.image, 
      likes: 0, 
      isLiked: false, 
      comments: [], 
      commentCount: 0, 
      createdAt: post.createdAt 
    };
    
    io.emit('new_post', data);
    res.json({ success: true, post: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    const idx = post.likes.indexOf(req.user.id);
    let liked;
    if (idx > -1) { 
      post.likes.splice(idx, 1); 
      liked = false; 
    } else { 
      post.likes.push(req.user.id); 
      liked = true; 
    }
    
    await post.save();
    io.emit('post_liked', { postId: post.id, likes: post.likes.length, liked });
    res.json({ success: true, liked, likes: post.likes.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/posts/:id/comment', auth, async (req, res) => {
  try {
    const { text } = req.body;
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    
    const comment = { username: req.user.username, text, createdAt: new Date().toISOString() };
    post.comments.push(comment);
    await post.save();
    
    io.emit('new_comment', { postId: post.id, comment, commentCount: post.comments.length });
    res.json({ success: true, comment });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DIRECT MESSAGE ROUTES ────────────────────────────
app.get('/api/messages/:userId', auth, async (req, res) => {
  const msgs = await Message.find({
    $or: [
      { senderId: req.user.id, receiverId: req.params.userId },
      { senderId: req.params.userId, receiverId: req.user.id }
    ]
  }).sort({ createdAt: 1 });
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
  res.json({ users });
});

// ─── SOCKET.IO (Real-Time) ────────────────────────────
const socketToUser = {};
const userToSocket = {};

io.on('connection', (socket) => {
  socket.on('user_join', ({ id }) => {
    socketToUser[socket.id] = id;
    userToSocket[id] = socket.id;
    io.emit('online_count', Object.keys(userToSocket).length);
  });

  socket.on('direct_message', async ({ receiverId, text }) => {
    const senderId = socketToUser[socket.id];
    if (!senderId || !receiverId) return;
    
    const msg = new Message({ id: generateId(), senderId, receiverId, text });
    await msg.save();
    
    // Emit to sender
    socket.emit('new_direct_message', msg);
    // Emit to receiver if online
    const receiverSocketId = userToSocket[receiverId];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('new_direct_message', msg);
    }
  });

  socket.on('disconnect', () => {
    const userId = socketToUser[socket.id];
    if (userId) {
      delete userToSocket[userId];
    }
    delete socketToUser[socket.id];
    io.emit('online_count', Object.keys(userToSocket).length);
  });
});

// Serve Frontend Fallback
app.use((req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Snappic Premium running on port ${PORT}`));
