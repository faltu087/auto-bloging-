const fs = require('fs');
const path = require('path');
require('dotenv').config();

let dbType = 'json';
let db = null;
const jsonFilePath = path.join(__dirname, 'posts.json');
const settingsFilePath = path.join(__dirname, 'settings.json');
const subsFilePath = path.join(__dirname, 'subscribers.json');
const commentsFilePath = path.join(__dirname, 'comments.json');

// Initialize local JSON files if they don't exist
if (!fs.existsSync(jsonFilePath)) {
    fs.writeFileSync(jsonFilePath, JSON.stringify([], null, 2));
}
if (!fs.existsSync(settingsFilePath)) {
    const defaultSettings = {
        siteTitle: "Auto-Blogging Portal",
        siteTagline: "ऑटोमेटेड ब्लॉगिंग और कंटेंट हब",
        siteDescription: "प्रीमियम और प्रोफेशनल ऑटो-ब्लॉगिंग वेबसाइट",
        adminPassword: process.env.ADMIN_PASSWORD || "9696",
        authorName: "Admin",
        postsPerPage: 10
    };
    fs.writeFileSync(settingsFilePath, JSON.stringify(defaultSettings, null, 2));
}
if (!fs.existsSync(subsFilePath)) {
    fs.writeFileSync(subsFilePath, JSON.stringify([], null, 2));
}
if (!fs.existsSync(commentsFilePath)) {
    fs.writeFileSync(commentsFilePath, JSON.stringify([], null, 2));
}

// Attempt Firebase Admin initialization
const serviceAccountName = process.env.FIREBASE_SERVICE_ACCOUNT || 'serviceAccountKey.json';
const serviceAccountPath = path.join(__dirname, serviceAccountName);

if (fs.existsSync(serviceAccountPath)) {
    try {
        const admin = require('firebase-admin');
        const serviceAccount = require(serviceAccountPath);
        
        if (admin.apps.length === 0) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: process.env.FIREBASE_DATABASE_URL || undefined
            });
        }
        
        db = admin.firestore();
        dbType = 'firebase';
        console.log('[DATABASE] Successfully connected to Firebase Firestore!');
    } catch (err) {
        console.error('[DATABASE] Firebase initialization failed. Falling back to local JSON.', err.message);
    }
} else {
    console.log('[DATABASE] serviceAccountKey.json not found. Running with local JSON database.');
}

// Helpers for JSON Database
function readJsonFile(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Database Abstraction API
const dbApi = {
    getDbType: () => dbType,

    // ----------------------------------------------------
    // POSTS API
    // ----------------------------------------------------
    getPosts: async (options = {}) => {
        const { status, category, search, adminMode } = options;

        if (dbType === 'firebase') {
            try {
                let query = db.collection('posts');
                
                if (!adminMode) {
                    query = query.where('status', '==', 'published');
                } else if (status) {
                    query = query.where('status', '==', status);
                }

                if (category && category !== 'All') {
                    query = query.where('category', '==', category);
                }

                const snapshot = await query.orderBy('timestamp', 'desc').get();
                let posts = [];
                snapshot.forEach(doc => {
                    posts.push({ id: doc.id, ...doc.data() });
                });

                if (search) {
                    const searchLower = search.toLowerCase();
                    posts = posts.filter(post => 
                        post.title.toLowerCase().includes(searchLower) || 
                        post.content.toLowerCase().includes(searchLower)
                    );
                }

                return posts;
            } catch (err) {
                console.error('[DATABASE] Firestore read error:', err.message);
                return [];
            }
        } else {
            let posts = readJsonFile(jsonFilePath);

            if (!adminMode) {
                posts = posts.filter(post => post.status === 'published');
            } else if (status) {
                posts = posts.filter(post => post.status === status);
            }

            if (category && category !== 'All') {
                posts = posts.filter(post => post.category === category);
            }

            if (search) {
                const searchLower = search.toLowerCase();
                posts = posts.filter(post => 
                    post.title.toLowerCase().includes(searchLower) || 
                    post.content.toLowerCase().includes(searchLower)
                );
            }

            return posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        }
    },

    savePost: async (postData) => {
        const post = {
            title: postData.title,
            content: postData.content,
            category: postData.category || 'General',
            status: postData.status || 'published',
            access: postData.access || 'public', // 'public' or 'members' (Ghost feature)
            seoDescription: postData.seoDescription || '',
            views: 0,
            timestamp: postData.timestamp || new Date().toISOString()
        };

        if (dbType === 'firebase') {
            try {
                const docRef = await db.collection('posts').add(post);
                return { id: docRef.id, ...post };
            } catch (err) {
                console.error('[DATABASE] Firestore write error:', err.message);
                throw err;
            }
        } else {
            const posts = readJsonFile(jsonFilePath);
            post.id = 'post_' + Math.random().toString(36).substr(2, 9);
            posts.push(post);
            writeJsonFile(jsonFilePath, posts);
            return post;
        }
    },

    deletePost: async (id) => {
        if (dbType === 'firebase') {
            try {
                await db.collection('posts').doc(id).delete();
                const comments = await db.collection('comments').where('postId', '==', id).get();
                const batch = db.batch();
                comments.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
                return true;
            } catch (err) {
                console.error('[DATABASE] Firestore delete error:', err.message);
                throw err;
            }
        } else {
            let posts = readJsonFile(jsonFilePath);
            const originalLength = posts.length;
            posts = posts.filter(post => post.id !== id);
            writeJsonFile(jsonFilePath, posts);
            
            let comments = readJsonFile(commentsFilePath);
            comments = comments.filter(c => c.postId !== id);
            writeJsonFile(commentsFilePath, comments);

            return posts.length < originalLength;
        }
    },

    incrementViews: async (id) => {
        if (dbType === 'firebase') {
            try {
                const docRef = db.collection('posts').doc(id);
                const doc = await docRef.get();
                if (doc.exists) {
                    const newViews = (doc.data().views || 0) + 1;
                    await docRef.update({ views: newViews });
                    return newViews;
                }
                return 0;
            } catch (err) {
                console.error('[DATABASE] Firestore views update failed:', err.message);
                return 0;
            }
        } else {
            const posts = readJsonFile(jsonFilePath);
            const post = posts.find(p => p.id === id);
            if (post) {
                post.views = (post.views || 0) + 1;
                writeJsonFile(jsonFilePath, posts);
                return post.views;
            }
            return 0;
        }
    },

    // ----------------------------------------------------
    // COMMENTS API
    // ----------------------------------------------------
    getComments: async (postId) => {
        if (dbType === 'firebase') {
            try {
                const snapshot = await db.collection('comments')
                    .where('postId', '==', postId)
                    .orderBy('timestamp', 'asc')
                    .get();
                const comments = [];
                snapshot.forEach(doc => {
                    comments.push({ id: doc.id, ...doc.data() });
                });
                return comments;
            } catch (err) {
                console.error('[DATABASE] Firestore comments error:', err.message);
                return [];
            }
        } else {
            const comments = readJsonFile(commentsFilePath);
            return comments
                .filter(c => c.postId === postId)
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        }
    },

    addComment: async (postId, commentData) => {
        const comment = {
            postId: postId,
            authorName: commentData.authorName || 'Guest',
            commentText: commentData.commentText,
            timestamp: new Date().toISOString()
        };

        if (dbType === 'firebase') {
            try {
                const docRef = await db.collection('comments').add(comment);
                return { id: docRef.id, ...comment };
            } catch (err) {
                console.error('[DATABASE] Firestore add comment failed:', err.message);
                throw err;
            }
        } else {
            const comments = readJsonFile(commentsFilePath);
            comment.id = 'comm_' + Math.random().toString(36).substr(2, 9);
            comments.push(comment);
            writeJsonFile(commentsFilePath, comments);
            return comment;
        }
    },

    // ----------------------------------------------------
    // SUBSCRIBERS API
    // ----------------------------------------------------
    getSubscribers: async () => {
        if (dbType === 'firebase') {
            try {
                const snapshot = await db.collection('subscribers').orderBy('timestamp', 'desc').get();
                const subs = [];
                snapshot.forEach(doc => {
                    subs.push({ id: doc.id, ...doc.data() });
                });
                return subs;
            } catch (err) {
                console.error('[DATABASE] Firestore subs read error:', err.message);
                return [];
            }
        } else {
            return readJsonFile(subsFilePath).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        }
    },

    addSubscriber: async (email) => {
        const sub = {
            email: email,
            timestamp: new Date().toISOString()
        };

        if (dbType === 'firebase') {
            try {
                const existing = await db.collection('subscribers').where('email', '==', email).get();
                if (!existing.empty) return { alreadyExists: true };

                const docRef = await db.collection('subscribers').add(sub);
                return { id: docRef.id, ...sub };
            } catch (err) {
                console.error('[DATABASE] Firestore sub add error:', err.message);
                throw err;
            }
        } else {
            const subs = readJsonFile(subsFilePath);
            if (subs.some(s => s.email === email)) return { alreadyExists: true };

            sub.id = 'sub_' + Math.random().toString(36).substr(2, 9);
            subs.push(sub);
            writeJsonFile(subsFilePath, subs);
            return sub;
        }
    },

    deleteSubscriber: async (id) => {
        if (dbType === 'firebase') {
            try {
                await db.collection('subscribers').doc(id).delete();
                return true;
            } catch (err) {
                console.error('[DATABASE] Firestore sub delete error:', err.message);
                throw err;
            }
        } else {
            let subs = readJsonFile(subsFilePath);
            const originalLength = subs.length;
            subs = subs.filter(s => s.id !== id);
            writeJsonFile(subsFilePath, subs);
            return subs.length < originalLength;
        }
    },

    // ----------------------------------------------------
    // SETTINGS API
    // ----------------------------------------------------
    getSettings: async () => {
        if (dbType === 'firebase') {
            try {
                const doc = await db.collection('settings').doc('config').get();
                if (doc.exists) {
                    return doc.data();
                } else {
                    const defaultSettings = {
                        siteTitle: "Auto-Blogging Portal",
                        siteTagline: "ऑटोमेटेड ब्लॉगिंग और कंटेंट हब",
                        siteDescription: "प्रीमियम और प्रोफेशनल ऑटो-ब्लॉगिंग वेबसाइट",
                        adminPassword: process.env.ADMIN_PASSWORD || "9696",
                        authorName: "Admin",
                        postsPerPage: 10
                    };
                    await db.collection('settings').doc('config').set(defaultSettings);
                    return defaultSettings;
                }
            } catch (err) {
                console.error('[DATABASE] Firestore settings read error:', err.message);
                return readJsonFile(settingsFilePath);
            }
        } else {
            return readJsonFile(settingsFilePath);
        }
    },

    saveSettings: async (settingsData) => {
        if (dbType === 'firebase') {
            try {
                await db.collection('settings').doc('config').update(settingsData);
                return settingsData;
            } catch (err) {
                console.error('[DATABASE] Firestore settings write error:', err.message);
                throw err;
            }
        } else {
            const current = readJsonFile(settingsFilePath);
            const updated = { ...current, ...settingsData };
            writeJsonFile(settingsFilePath, updated);
            return updated;
        }
    },

    // ----------------------------------------------------
    // DASHBOARD STATS API
    // ----------------------------------------------------
    getDashboardStats: async () => {
        let totalPosts = 0;
        let totalViews = 0;
        let totalSubscribers = 0;
        let totalComments = 0;

        if (dbType === 'firebase') {
            try {
                const postsSnap = await db.collection('posts').get();
                totalPosts = postsSnap.size;
                postsSnap.forEach(doc => {
                    totalViews += (doc.data().views || 0);
                });

                const subsSnap = await db.collection('subscribers').get();
                totalSubscribers = subsSnap.size;

                const commSnap = await db.collection('comments').get();
                totalComments = commSnap.size;
            } catch (err) {
                console.error('[DATABASE] Failed to aggregate Firestore stats:', err.message);
            }
        } else {
            const posts = readJsonFile(jsonFilePath);
            totalPosts = posts.length;
            posts.forEach(p => {
                totalViews += (p.views || 0);
            });

            const subs = readJsonFile(subsFilePath);
            totalSubscribers = subs.length;

            const comments = readJsonFile(commentsFilePath);
            totalComments = comments.length;
        }

        return { totalPosts, totalViews, totalSubscribers, totalComments };
    }
};

module.exports = dbApi;
