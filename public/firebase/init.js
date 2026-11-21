
import { app, auth, superAdminAuth, ownerAuth, db, isAdminOwnerPreview } from "./config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged,
  browserLocalPersistence,
  getIdTokenResult,
  setPersistence
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
  onSnapshot,
  orderBy,
  limit,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const isOwnerPage = window.location.pathname.startsWith("/owner/");
const sessionAuth = isAdminOwnerPreview ? superAdminAuth : isOwnerPage ? ownerAuth : auth;
const functions = getFunctions(sessionAuth.app, "asia-south1");

// Let the owner dashboard wait until Firebase setup and Super Admin preview verification finish.
window.firebaseReadyPromise = new Promise(resolve => {
  window.addEventListener("firebase-ready", resolve, { once: true });
});

// Public, Owner, and Super Admin sessions each use their own browser-persisted Firebase Auth instance.
await setPersistence(sessionAuth, browserLocalPersistence);
if (isAdminOwnerPreview) await superAdminAuth.authStateReady();

window.firebaseApp = app;
window.firebaseAuth = sessionAuth;
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

  ensureCustomerSignedIn: async () => {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
      const error = new Error("Please sign in with a customer account before booking.");
      error.code = "auth/customer-sign-in-required";
      throw error;
    }
    return user.uid;
  },

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

  saveOwnerGrounds: async (database, uid, email, grounds, activity = null) => {
    const ref = collection(database, "grounds");
    const existing = await getDocs(query(ref, where("ownerUid", "==", uid)));
    const keep = new Set(grounds.map(ground => String(ground.id)));
    // Save grounds independently so an Activity Log permission issue cannot block Ground Add/Edit/Delete.
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

    // Activity logging is separate and must never undo or block a successful ground save.
    if (activity) {
      try {
        const activityRef = firestoreDoc(collection(database, "ownerActivityLogs"));
        await firestoreSetDoc(activityRef, {
          ownerUid: uid,
          ownerEmail: email,
          ownerName: String(activity.ownerName || "Owner"),
          actorUid: String(activity.actorUid || ""),
          actorEmail: String(activity.actorEmail || ""),
          actorName: String(activity.actorName || activity.actorEmail || "Owner"),
          activityType: String(activity.activityType || ""),
          groundId: String(activity.groundId || ""),
          groundName: String(activity.groundName || "Sports Ground"),
          sport: String(activity.sport || ""),
          location: String(activity.location || ""),
          createdAt: serverTimestamp()
        });
      } catch (error) {
        console.error("Owner Activity Log could not be saved:", error);
      }
    }
  },

  watchPublicGrounds: (database, onChange, onError) =>
    onSnapshot(collection(database, "grounds"), snapshot =>
      onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      onError
    ),

  saveBooking: async (database, booking) => {
    await sessionAuth.authStateReady();
    const user = sessionAuth.currentUser;
    if (!user || user.isAnonymous) {
      const error = new Error("Please sign in before creating a booking.");
      error.code = "auth/customer-sign-in-required";
      throw error;
    }
    try {
      const result = await httpsCallable(functions, "createBooking")({
        groundId:String(booking.groundId || ""), date:String(booking.date || ""),
        startTime:String(booking.startTime || ""), endTime:String(booking.endTime || ""),
        customerName:String(booking.customerName || ""), phone:String(booking.phone || ""),
        bookingMode:booking.bookingSource === "Owner dashboard" ? "owner" : "customer"
      });
      Object.assign(booking, {
        id:result.data.bookingId, amount:result.data.amount, status:result.data.status,
        paymentStatus:result.data.paymentStatus, bookingSource:result.data.bookingSource,
        customerUid:result.data.customerUid || undefined, createdAt:result.data.createdAt,
        holdExpiresAt:result.data.holdExpiresAt, slotIds:result.data.slotIds
      });
      return result.data;
    } catch (error) {
      if (error.code === "functions/already-exists") error.code = "booking/slot-taken";
      throw error;
    }
  },

  saveBookingRecord: (database, booking) => window.firebaseAuthApi.saveBooking(database, booking),

  getOwnerBookings: async (database, uid) => {
    const result = await getDocs(query(collection(database, "bookings"), where("ownerUid", "==", uid)));
    return result.docs.map(item => ({ id: item.id, ...item.data() }));
  },

  watchOwnerBookings: (database, uid, onChange, onError) =>
    onSnapshot(query(collection(database, "bookings"), where("ownerUid", "==", uid)), snapshot =>
      onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      onError
    ),

  watchOwnerNotifications: (database, uid, onChange, onError) =>
    onSnapshot(query(
      collection(database, "ownerNotifications", String(uid), "items"),
      orderBy("createdAt", "desc"),
      limit(100)
    ), snapshot =>
      onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      onError
    ),

  markOwnerNotificationsRead: async (database, uid, notificationIds) => {
    const ids = Array.from(new Set((notificationIds || []).map(String))).filter(Boolean);
    await Promise.all(ids.map(id => updateDoc(
      firestoreDoc(database, "ownerNotifications", String(uid), "items", id),
      { read: true, readAt: serverTimestamp() }
    )));
  },

  watchAllBookings: (database, onChange, onError) =>
    onSnapshot(collection(database, "bookings"), snapshot =>
      onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      onError
    ),

  watchPublicBookingSlots: (database, groundId, onChange, onError) =>
    onSnapshot(query(collection(database, "bookingSlots"), where("groundId", "==", String(groundId))), snapshot =>
      onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      onError
    ),

  updateBooking: async (database, bookingId, changes) => {
    const bookingRef = firestoreDoc(database,"bookings",String(bookingId));
    await runTransaction(database,async transaction => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists()) throw new Error("Booking not found.");
      const booking = bookingSnapshot.data();
      const slotIds = Array.isArray(booking.slotIds) ? booking.slotIds : [];
      const slotRefs = slotIds.map(id => firestoreDoc(database,"bookingSlots",id));
      const slotSnapshots = await Promise.all(slotRefs.map(ref => transaction.get(ref)));
      transaction.update(bookingRef,{...changes,updatedAt:serverTimestamp()});
      if (changes.status === "Confirmed") {
        slotRefs.forEach((ref,index) => {
          if (slotSnapshots[index].exists() && slotSnapshots[index].data().bookingId === String(bookingId)) {
            transaction.update(ref,{status:"Confirmed",holdExpiresAt:0,updatedAt:serverTimestamp()});
          }
        });
      } else if (["Rejected","Expired","Cancelled"].includes(changes.status)) {
        slotRefs.forEach((ref,index) => {
          if (slotSnapshots[index].exists() && slotSnapshots[index].data().bookingId === String(bookingId)) transaction.delete(ref);
        });
      }
    });
  },

  updateBookingPaymentStatus: async (database, bookingId, paymentStatus) => {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
      const error = new Error("Please sign in with the customer account used for this booking.");
      error.code = "auth/customer-sign-in-required";
      throw error;
    }
    return updateDoc(firestoreDoc(database, "bookings", String(bookingId)), {
      paymentStatus,
      updatedAt: serverTimestamp()
    });
  }
};

if (isAdminOwnerPreview) {
  try {
    if (!window.opener) throw new Error("This Admin Preview must be opened from Super Admin.");
    const ownerUid = await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", receiveTarget);
        reject(new Error("Super Admin did not provide an owner account."));
      }, 30000);
      function receiveTarget(event) {
        if (event.origin !== window.location.origin || event.source !== window.opener
          || !event.data || event.data.type !== "BOXBOOK_OWNER_PREVIEW_TARGET") return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", receiveTarget);
        const uid = typeof event.data.ownerUid === "string" ? event.data.ownerUid.trim() : "";
        if (!uid || uid.length > 128) {
          reject(new Error("The selected owner account was invalid."));
          return;
        }
        resolve(uid);
      }
      window.addEventListener("message", receiveTarget);
      window.opener.postMessage({ type: "BOXBOOK_OWNER_PREVIEW_READY" }, window.location.origin);
    });
    const currentUser = superAdminAuth.currentUser || await new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      unsubscribe = onAuthStateChanged(superAdminAuth, user => {
        unsubscribe();
        resolve(user);
      }, error => {
        unsubscribe();
        reject(error);
      });
    });
    if (!currentUser) throw new Error("Please sign in to Super Admin before opening an owner preview.");
    const tokenResult = await getIdTokenResult(currentUser, true);
    if (tokenResult.claims.superAdmin !== true) throw new Error("This account is not authorized for Super Admin preview.");
    window.adminOwnerPreviewTargetUid = ownerUid;
    window.adminOwnerPreviewAdminUid = currentUser.uid;
  } catch (error) {
    console.error("Super Admin owner preview could not start:", error);
    window.ownerPreviewError = error;
  }
}

console.log("Firebase initialized successfully.");
window.dispatchEvent(new Event("firebase-ready"));
