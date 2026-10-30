import { app, auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

window.firebaseApp = app;
window.firebaseAuth = auth;
window.firebaseDB = db;
window.firebaseAuthApi = {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  saveOwnerProfile: (database, uid, profile) => setDoc(doc(database, "owners", uid), {
    ...profile,
    createdAt: serverTimestamp()
  })
};

console.log("Firebase initialized successfully.");
window.dispatchEvent(new Event("firebase-ready"));
