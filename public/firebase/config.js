const firebaseConfig = {
  apiKey: "AIzaSyBD9SqHkNfIKlEoL4l3WSIb_hZ37LTU-Kk",
  authDomain: "box-book-india-5183f.firebaseapp.com",
  projectId: "box-book-india-5183f",
  storageBucket: "box-book-india-5183f.firebasestorage.app",
  messagingSenderId: "625081417102",
  appId: "1:625081417102:web:c922a00e8ab3d8677b38df",
  measurementId: "G-EQBZ6K59PV"
};
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const isAdminOwnerPreview = new URLSearchParams(window.location.search).get("adminOwnerPreview") === "1";
const app = getApps().find(existing => existing.name === "[DEFAULT]") || initializeApp(firebaseConfig);
// Keep Super Admin and Owner sign-in on separate named Firebase apps and persistence keys.
const superAdminApp = getApps().find(existing => existing.name === "SUPER_ADMIN_AUTH") || initializeApp(firebaseConfig, "SUPER_ADMIN_AUTH");
const superAdminAuth = getAuth(superAdminApp);
const auth = getAuth(app);
const ownerApp = getApps().find(existing => existing.name === "OWNER_AUTH") || initializeApp(firebaseConfig, "OWNER_AUTH");
const ownerAuth = getAuth(ownerApp);
const isOwnerPage = window.location.pathname.startsWith("/owner/");
const isSuperAdminPage = window.location.pathname === "/superadmin.html" || window.location.pathname === "/superadmin";
const sessionApp = (isAdminOwnerPreview || isSuperAdminPage) ? superAdminApp : isOwnerPage ? ownerApp : app;
const db = getFirestore(sessionApp);

export { app, auth, superAdminAuth, ownerAuth, db, isAdminOwnerPreview };
