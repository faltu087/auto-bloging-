const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Setup Public Uploads Directory
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer Storage Configuration for Image Uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, 'media-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

// Custom helper to get current admin password
async function getAdminPassword() {
    const settings = await db.getSettings();
    return settings.adminPassword || '9696';
}

// Custom middleware to verify Admin Cookie
async function requireAdmin(req, res, next) {
    const adminPassword = await getAdminPassword();
    if (req.cookies.admin_auth === adminPassword) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized. Please login as admin.' });
    }
}

// Routes
// 1. Admin Page route (Protected)
app.get('/admin', async (req, res) => {
    const adminPassword = await getAdminPassword();
    if (req.cookies.admin_auth === adminPassword) {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else {
        res.redirect('/login');
    }
});

// 2. Login Page route
app.get('/login', async (req, res) => {
    const adminPassword = await getAdminPassword();
    if (req.cookies.admin_auth === adminPassword) {
        res.redirect('/admin');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

// 3. API - Login Auth
app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    const adminPassword = await getAdminPassword();
    if (password === adminPassword) {
        res.cookie('admin_auth', adminPassword, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true });
        res.json({ success: true, message: 'Logged in successfully!' });
    } else {
        res.status(401).json({ success: false, error: 'Incorrect Password!' });
    }
});

// 4. API - Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('admin_auth');
    res.json({ success: true, message: 'Logged out successfully!' });
});

// 5. API - Get Database Info
app.get('/api/db-info', (req, res) => {
    res.json({ dbType: db.getDbType() });
});

// 6. API - Settings Routes
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await db.getSettings();
        const publicSettings = { ...settings };
        delete publicSettings.adminPassword;
        res.json(publicSettings);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve settings.' });
    }
});

app.post('/api/settings', requireAdmin, async (req, res) => {
    const { siteTitle, siteTagline, siteDescription, adminPassword, authorName } = req.body;
    try {
        const updatedData = {};
        if (siteTitle !== undefined) updatedData.siteTitle = siteTitle;
        if (siteTagline !== undefined) updatedData.siteTagline = siteTagline;
        if (siteDescription !== undefined) updatedData.siteDescription = siteDescription;
        if (authorName !== undefined) updatedData.authorName = authorName;
        if (adminPassword !== undefined && adminPassword.trim() !== "") updatedData.adminPassword = adminPassword;

        const updated = await db.saveSettings(updatedData);
        
        if (updatedData.adminPassword) {
            res.cookie('admin_auth', updatedData.adminPassword, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true });
        }

        res.json({ success: true, settings: updated });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update settings.' });
    }
});

// 7. API - Subscribers Routes
app.post('/api/subscribers', async (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    try {
        const result = await db.addSubscriber(email);
        if (result.alreadyExists) {
            return res.json({ success: true, message: 'You are already subscribed!' });
        }
        res.json({ success: true, message: 'Subscribed successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save subscription.' });
    }
});

app.get('/api/subscribers', requireAdmin, async (req, res) => {
    try {
        const subs = await db.getSubscribers();
        res.json(subs);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch subscribers.' });
    }
});

app.delete('/api/subscribers/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await db.deleteSubscriber(id);
        res.json({ success: true, message: 'Subscriber removed.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove subscriber.' });
    }
});

// 8. API - Get Blog Posts
app.get('/api/posts', async (req, res) => {
    const { category, search } = req.query;
    const adminPassword = await getAdminPassword();
    const adminMode = req.cookies.admin_auth === adminPassword;

    try {
        const posts = await db.getPosts({ category, search, adminMode });
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve posts.' });
    }
});

// 9. API - Add Blog Post (Includes Ghost 'access' parameter)
app.post('/api/posts', requireAdmin, async (req, res) => {
    const { title, content, category, status, seoDescription, access } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required.' });
    }
    try {
        const newPost = await db.savePost({ title, content, category, status, seoDescription, access });
        res.json({ success: true, post: newPost });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save post.' });
    }
});

// 10. API - Increment Views
app.post('/api/posts/:id/view', async (req, res) => {
    const { id } = req.params;
    try {
        const newViews = await db.incrementViews(id);
        res.json({ success: true, views: newViews });
    } catch (err) {
        res.status(500).json({ error: 'Failed to increment views.' });
    }
});

// 11. API - Delete Blog Post
app.delete('/api/posts/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const deleted = await db.deletePost(id);
        if (deleted) {
            res.json({ success: true, message: 'Post deleted successfully!' });
        } else {
            res.status(404).json({ error: 'Post not found.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete post.' });
    }
});

// 12. API - Comments Routes
app.get('/api/comments', async (req, res) => {
    const { postId } = req.query;
    if (!postId) return res.status(400).json({ error: 'postId query parameter is required.' });
    try {
        const comments = await db.getComments(postId);
        res.json(comments);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve comments.' });
    }
});

app.post('/api/comments', async (req, res) => {
    const { postId, authorName, commentText } = req.body;
    if (!postId || !commentText) {
        return res.status(400).json({ error: 'postId and commentText are required.' });
    }
    try {
        const newComment = await db.addComment(postId, { authorName, commentText });
        res.json({ success: true, comment: newComment });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save comment.' });
    }
});

// 13. API - Media Upload
app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Please upload an image file.' });
    }
    const fileUrl = '/uploads/' + req.file.filename;
    res.json({ success: true, url: fileUrl });
});

// 14. API - Dashboard Stats
app.get('/api/stats', requireAdmin, async (req, res) => {
    try {
        const stats = await db.getDashboardStats();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve dashboard stats.' });
    }
});

// Serve public static assets
app.use(express.static(path.join(__dirname, 'public')));

// Catch all - redirect to main page
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log('='*60);
    console.log(`[SERVER] Auto-Blogging Ghost & WordPress Portal is running!`);
    console.log(`[SERVER] URL: http://localhost:${PORT}`);
    console.log(`[SERVER] Admin Panel: http://localhost:${PORT}/admin`);
    console.log('='*60);
});
