const firebaseConfig = {
  apiKey: "AIzaSyBD9SqHkNfIKlEoL4l3WSIb_hZ37LTU-Kk",
  authDomain: "box-book-india-5183f.firebaseapp.com",
  projectId: "box-book-india-5183f",
  storageBucket: "box-book-india-5183f.firebasestorage.app",
  messagingSenderId: "625081417102",
  appId: "1:625081417102:web:c922a00e8ab3d8677b38df",
  measurementId: "G-EQBZ6K59PV"
};
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
