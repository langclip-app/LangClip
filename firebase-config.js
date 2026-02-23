// ===== Firebase Configuration =====

const firebaseConfig = {
    apiKey: "AIzaSyBAYq8Qx1I6rftQK0XVevQP7BmkESvUe_U",
    authDomain: "langclip-8fa1a.firebaseapp.com",
    projectId: "langclip-8fa1a",
    storageBucket: "langclip-8fa1a.firebasestorage.app",
    messagingSenderId: "155104077591",
    appId: "1:155104077591:web:b36fa82efd1bbb8a963952",
    measurementId: "G-6T7PV6BD16"
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
    window.__FIREBASE_CONFIGURED__ = true;
} catch (e) {
    window.__FIREBASE_CONFIGURED__ = false;
    console.error('Firebase initialization error:', e);
}
