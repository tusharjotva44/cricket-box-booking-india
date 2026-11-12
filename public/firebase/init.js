
import { app, auth, db, isAdminOwnerPreview } from "./config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged,
  browserLocalPersistence,
  inMemoryPersistence,
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
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// Let the owner dashboard wait until Firebase setup and any admin token handoff finish.
window.firebaseReadyPromise = new Promise(resolve => {
  window.addEventListener("firebase-ready", resolve, { once: true });
});

// Normal owner sessions persist; Super Admin owner sessions stay isolated to this tab.
await setPersistence(auth, isAdminOwnerPreview ? inMemoryPersistence : browserLocalPersistence);

window.firebaseApp = app;
window.firebaseAuth = auth;
window.firebaseDB = db;

window.firebaseAuthApi = {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCustomToken,
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
    ),

  saveBooking: async (database, booking) => {
    const start = /^\d{2}:\d{2}$/.test(booking.startTime || '') ? Number(booking.startTime.slice(0,2)) * 60 + Number(booking.startTime.slice(3,5)) : null;
    const rawEnd = /^\d{2}:\d{2}$/.test(booking.endTime || '') ? Number(booking.endTime.slice(0,2)) * 60 + Number(booking.endTime.slice(3,5)) : null;
    const end = start === null || rawEnd === null ? null : (rawEnd <= start ? rawEnd + 1440 : rawEnd);
    const slotIds = [];
    const slotMinutes = [];
    if (start !== null && end !== null && end > start && (end - start) <= 1440 && (end - start) % 30 === 0) {
      const baseDate = new Date(String(booking.date) + 'T00:00:00Z');
      for (let minute = start; minute < end; minute += 30) {
        const day = new Date(baseDate);
        day.setUTCDate(day.getUTCDate() + Math.floor(minute / 1440));
        const dateKey = day.toISOString().slice(0,10);
        const minuteOfDay = minute % 1440;
        const slotId = encodeURIComponent(String(booking.groundId)) + '_' + dateKey + '_' + String(minuteOfDay).padStart(4,'0');
        slotIds.push(slotId);
        slotMinutes.push({slotId,date:dateKey,minute:minuteOfDay});
      }
    }
    const bookingRef = firestoreDoc(database, "bookings", String(booking.id));
    if (!slotIds.length) {
      await firestoreSetDoc(bookingRef, {...booking,createdAt:Number(booking.createdAt || Date.now()),updatedAt:serverTimestamp()});
      return;
    }
    await runTransaction(database, async transaction => {
      const slotRefs = slotIds.map(id => firestoreDoc(database,"bookingSlots",id));
      const snapshots = await Promise.all(slotRefs.map(ref => transaction.get(ref)));
      const conflict = snapshots.some(snapshot => {
        if (!snapshot.exists() || snapshot.data().bookingId === String(booking.id)) return false;
        const slot = snapshot.data();
        return !(slot.status === "Pending" && Number(slot.holdExpiresAt || 0) <= Date.now());
      });
      if (conflict) {
        const error = new Error("This time slot is already booked. Please choose another time.");
        error.code = "booking/slot-taken";
        throw error;
      }
      transaction.set(bookingRef, {
        ...booking,
        slotIds,
        createdAt:Number(booking.createdAt || Date.now()),
        updatedAt:serverTimestamp()
      });
      slotMinutes.forEach(slot => {
        transaction.set(firestoreDoc(database,"bookingSlots",slot.slotId), {
          bookingId:String(booking.id),
          groundId:String(booking.groundId),
          ownerUid:String(booking.ownerUid),
          date:slot.date,
          minute:slot.minute,
          status:booking.status || "Pending",
          holdExpiresAt:Number(booking.holdExpiresAt || 0),
          updatedAt:serverTimestamp()
        });
      });
    });
  },

  saveBookingRecord: (database, booking) =>
    firestoreSetDoc(firestoreDoc(database, "bookings", String(booking.id)), {
      ...booking,
      createdAt: Number(booking.createdAt || Date.now()),
      updatedAt: serverTimestamp()
    }),

  getOwnerBookings: async (database, uid) => {
    const result = await getDocs(query(collection(database, "bookings"), where("ownerUid", "==", uid)));
    return result.docs.map(item => ({ id: item.id, ...item.data() }));
  },

  watchOwnerBookings: (database, uid, onChange, onError) =>
    onSnapshot(query(collection(database, "bookings"), where("ownerUid", "==", uid)), snapshot =>
      onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      onError
    ),

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

  updateBookingPaymentStatus: (database, bookingId, paymentStatus) =>
    updateDoc(firestoreDoc(database, "bookings", String(bookingId)), {
      paymentStatus,
      updatedAt: serverTimestamp()
    })
};

if (isAdminOwnerPreview) {
  try {
    if (!window.opener) throw new Error("This owner session must be opened from Super Admin.");
    const customToken = await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", receiveToken);
        reject(new Error("Super Admin did not provide an owner session token."));
      }, 30000);
      function receiveToken(event) {
        if (event.origin !== window.location.origin || event.source !== window.opener
          || !event.data || event.data.type !== "BOXBOOK_OWNER_PREVIEW_TOKEN") return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", receiveToken);
        if (typeof event.data.customToken !== "string" || !event.data.customToken) {
          reject(new Error("The owner session token was invalid."));
          return;
        }
        resolve(event.data.customToken);
      }
      window.addEventListener("message", receiveToken);
      window.opener.postMessage({ type: "BOXBOOK_OWNER_PREVIEW_READY" }, window.location.origin);
    });
    await signInWithCustomToken(auth, customToken);
  } catch (error) {
    console.error("Super Admin owner session could not start:", error);
    window.ownerPreviewError = error;
  }
}

console.log("Firebase initialized successfully.");
window.dispatchEvent(new Event("firebase-ready"));
