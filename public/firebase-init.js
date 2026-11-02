
import { app, auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  doc as firestoreDoc,
  getDocs,
  query,
  where,
  setDoc as firestoreSetDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

window.firebaseApp = app;
window.firebaseAuth = auth;
window.firebaseDB = db;

window.firebaseAuthApi = {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged,

  saveOwnerProfile: (database, uid, profile) =>
    setDoc(doc(database, "owners", uid), {
      ...profile,
      createdAt: serverTimestamp()
    }),

  getOwnerProfile: async (database, uid) => {
    const snapshot = await getDoc(doc(database, "owners", uid));
    return snapshot.exists() ? snapshot.data() : null;
  },

  updateOwnerProfile: (database, uid, profile) =>
    updateDoc(doc(database, "owners", uid), {
      ...profile,
      updatedAt: serverTimestamp()
    }),

  getOwnerGrounds: async (database, uid) => {
    const result = await getDocs(query(collection(database, "grounds"), where("ownerUid", "==", uid)));
    return result.docs.map(item => ({ id: item.id, ...item.data() }));
  },

  saveOwnerGrounds: async (database, uid, email, grounds) => {
    const ref = collection(database, "grounds");
    const existing = await getDocs(query(ref, where("ownerUid", "==", uid)));
    const keep = new Set(grounds.map(ground => String(ground.id)));
    for (const item of existing.docs) {
      if (!keep.has(item.id)) await deleteDoc(firestoreDoc(database, "grounds", item.id));
    }
    for (const ground of grounds) {
      const id = String(ground.id);
      const { id: ignoredId, ...data } = ground;
      await firestoreSetDoc(firestoreDoc(database, "grounds", id), {
        ...data,
        ownerUid: uid,
        owner: email,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
  },

  watchPublicGrounds: (database, onChange, onError) =>
    onSnapshot(collection(database, "grounds"), snapshot =>
      onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      onError
    )
};

console.log("Firebase initialized successfully.");
window.dispatchEvent(new Event("firebase-ready"));
