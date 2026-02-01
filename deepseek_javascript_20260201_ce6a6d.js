import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDxztzPoCTCzckaEsvupHJOyCHEhAxr9DU",
    authDomain: "zypso-mart-cd989.firebaseapp.com",
    projectId: "zypso-mart-cd989",
    storageBucket: "zypso-mart-cd989.firebasestorage.app",
    messagingSenderId: "91046649188",
    appId: "1:91046649188:web:0472d26bc617a5396f2e71"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Initialize analytics in production
if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    import("https://www.gstatic.com/firebasejs/9.22.0/firebase-analytics.js")
        .then(({ getAnalytics }) => {
            const analytics = getAnalytics(app);
            console.log('Analytics initialized');
        });
}