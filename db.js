const fs = require('fs');
const path = require('path');
require('dotenv').config();

let dbType = 'json';
let db = null;
const jsonFilePath = path.join(__dirname, 'posts.json');

// Initialize local JSON file if it doesn't exist
if (!fs.existsSync(jsonFilePath)) {
    fs.writeFileSync(jsonFilePath, JSON.stringify([], null, 2));
}

// Attempt Firebase Admin initialization
const serviceAccountName = process.env.FIREBASE_SERVICE_ACCOUNT || 'serviceAccountKey.json';
const serviceAccountPath = path.join(__dirname, serviceAccountName);

if (fs.existsSync(serviceAccountPath)) {
    try {
        const admin = require('firebase-admin');
        const serviceAccount = require(serviceAccountPath);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL || undefined
        });
        
        db = admin.firestore();
        dbType = 'firebase';
        console.log('[DATABASE] Successfully connected to Firebase Firestore!');
    } catch (err) {
        console.error('[DATABASE] Firebase initialization failed. Falling back to local JSON.', err.message);
    }
} else {
    console.log('[DATABASE] serviceAccountKey.json not found. Running with local JSON database.');
}

// Helper to read JSON database
function readJsonDb() {
    try {
        const data = fs.readFileSync(jsonFilePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

// Helper to write JSON database
function writeJsonDb(data) {
    fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf8');
}

// Database Abstraction API
const dbApi = {
    getDbType: () => dbType,

    getPosts: async () => {
        if (dbType === 'firebase') {
            try {
                const snapshot = await db.collection('posts').orderBy('timestamp', 'desc').get();
                const posts = [];
                snapshot.forEach(doc => {
                    posts.push({ id: doc.id, ...doc.data() });
                });
                return posts;
            } catch (err) {
                console.error('[DATABASE] Firestore read error:', err.message);
                return [];
            }
        } else {
            const posts = readJsonDb();
            // Sort by timestamp desc
            return posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        }
    },

    savePost: async (postData) => {
        const post = {
            title: postData.title,
            content: postData.content,
            category: postData.category || 'General',
            timestamp: postData.timestamp || new Date().toISOString(),
            views: 0
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
            const posts = readJsonDb();
            post.id = 'post_' + Math.random().toString(36).substr(2, 9);
            posts.push(post);
            writeJsonDb(posts);
            return post;
        }
    },

    deletePost: async (id) => {
        if (dbType === 'firebase') {
            try {
                await db.collection('posts').doc(id).delete();
                return true;
            } catch (err) {
                console.error('[DATABASE] Firestore delete error:', err.message);
                throw err;
            }
        } else {
            let posts = readJsonDb();
            const originalLength = posts.length;
            posts = posts.filter(post => post.id !== id);
            writeJsonDb(posts);
            return posts.length < originalLength;
        }
    }
};

module.exports = dbApi;
