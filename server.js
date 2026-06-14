const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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
        // Set cookie valid for 7 days
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
        // Hide password when sending to public
        const publicSettings = { ...settings };
        delete publicSettings.adminPassword;
        res.json(publicSettings);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve settings.' });
    }
});

app.post('/api/settings', requireAdmin, async (req, res) => {
    const { siteTitle, siteTagline, siteDescription, adminPassword } = req.body;
    try {
        const updatedData = {};
        if (siteTitle !== undefined) updatedData.siteTitle = siteTitle;
        if (siteTagline !== undefined) updatedData.siteTagline = siteTagline;
        if (siteDescription !== undefined) updatedData.siteDescription = siteDescription;
        if (adminPassword !== undefined && adminPassword.trim() !== "") updatedData.adminPassword = adminPassword;

        const updated = await db.saveSettings(updatedData);
        
        // If password changed, update session cookie
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

// 8. API - Get Blog Posts (Public / Admin Filtered)
app.get('/api/posts', async (req, res) => {
    const { category, search } = req.query;
    
    // Check if the requester is authenticated as admin
    const adminPassword = await getAdminPassword();
    const adminMode = req.cookies.admin_auth === adminPassword;

    try {
        const posts = await db.getPosts({ category, search, adminMode });
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve posts.' });
    }
});

// 9. API - Add Blog Post (Protected)
app.post('/api/posts', requireAdmin, async (req, res) => {
    const { title, content, category, status, seoDescription } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required.' });
    }
    try {
        const newPost = await db.savePost({ title, content, category, status, seoDescription });
        res.json({ success: true, post: newPost });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save post.' });
    }
});

// 10. API - Increment Views (Public)
app.post('/api/posts/:id/view', async (req, res) => {
    const { id } = req.params;
    try {
        const newViews = await db.incrementViews(id);
        res.json({ success: true, views: newViews });
    } catch (err) {
        res.status(500).json({ error: 'Failed to increment views.' });
    }
});

// 11. API - Delete Blog Post (Protected)
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
