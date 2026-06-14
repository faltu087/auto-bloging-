const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '9696';

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Custom middleware to verify Admin Cookie
function requireAdmin(req, res, next) {
    if (req.cookies.admin_auth === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized. Please login as admin.' });
    }
}

// Routes
// 1. Admin Page route (Protected)
app.get('/admin', (req, res) => {
    if (req.cookies.admin_auth === ADMIN_PASSWORD) {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else {
        res.redirect('/login');
    }
});

// 2. Login Page route
app.get('/login', (req, res) => {
    if (req.cookies.admin_auth === ADMIN_PASSWORD) {
        res.redirect('/admin');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

// 3. API - Login Auth
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        // Set cookie valid for 7 days
        res.cookie('admin_auth', ADMIN_PASSWORD, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true });
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

// 6. API - Get Blog Posts (Public)
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await db.getPosts();
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve posts.' });
    }
});

// 7. API - Add Blog Post (Protected)
app.post('/api/posts', requireAdmin, async (req, res) => {
    const { title, content, category } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required.' });
    }
    try {
        const newPost = await db.savePost({ title, content, category });
        res.json({ success: true, post: newPost });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save post.' });
    }
});

// 8. API - Delete Blog Post (Protected)
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

// Serve public static assets
app.use(express.static(path.join(__dirname, 'public')));

// Catch all - redirect to main page
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log('='*60);
    console.log(`[SERVER] Auto-Blogging Website is running!`);
    console.log(`[SERVER] URL: http://localhost:${PORT}`);
    console.log(`[SERVER] Admin Panel: http://localhost:${PORT}/admin`);
    console.log('='*60);
});
