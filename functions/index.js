const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");

initializeApp();
setGlobalOptions({ region: "asia-south1", maxInstances: 3 });

// Activate a paid owner plan and record its transaction atomically.
// A future provider webhook must verify its signature and the payment/order
// details, then pass the immutable plan snapshot saved when the order was made.
async function activateOwnerPlanAfterVerifiedPayment({
  recordId,
  txnId,
  ownerId,
  plan,
  amount,
  currency = "INR",
  provider,
  providerOrderId,
  providerPaymentId
}) {
  if (typeof recordId !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(recordId)) {
    throw new HttpsError("invalid-argument", "A valid unique payment record ID is required.");
  }
  if (typeof ownerId !== "string" || !ownerId || !plan || typeof plan.id !== "string" ||
      typeof plan.name !== "string" || !plan.name) {
    throw new HttpsError("invalid-argument", "Verified owner and plan details are required.");
  }
  if (!provider || !providerPaymentId || !providerOrderId) {
    throw new HttpsError("invalid-argument", "Verified payment provider, order ID and payment ID are required.");
  }
  if (plan.kind === "trial") {
    throw new HttpsError("failed-precondition", "A free trial cannot be activated as a paid gateway purchase.");
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new HttpsError("invalid-argument", "A valid verified payment amount is required.");
  }
  const durationValue = Number(plan.durationValue || 1);
  const durationUnit = String(plan.durationUnit || "months");
  const groundLimit = Number(plan.grounds || 1);
  if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 120 ||
      !["days", "months", "years"].includes(durationUnit) ||
      !Number.isInteger(groundLimit) || groundLimit < 1 || groundLimit > 100) {
    throw new HttpsError("invalid-argument", "The saved subscription plan details are invalid.");
  }

  const db = getFirestore();
  const ownerRef = db.collection("owners").doc(ownerId);
  const transactionRef = db.collection("transactionHistory").doc(recordId);
  return db.runTransaction(async transaction => {
    const [ownerSnapshot, existingTransaction] = await Promise.all([
      transaction.get(ownerRef),
      transaction.get(transactionRef)
    ]);
    if (existingTransaction.exists) {
      // Duplicate webhook delivery: do not extend the plan or add another row.
      return { alreadyProcessed: true };
    }
    if (!ownerSnapshot.exists) {
      throw new HttpsError("not-found", "The owner account for this payment could not be found.");
    }

    const now = new Date();
    const expiry = new Date(now);
    if (durationUnit === "days") expiry.setDate(expiry.getDate() + durationValue);
    else if (durationUnit === "years") expiry.setFullYear(expiry.getFullYear() + durationValue);
    else expiry.setMonth(expiry.getMonth() + durationValue);

    const ownerData = ownerSnapshot.data() || {};
    const ownerName = String(ownerData.fullName || ownerData.yourName || "Owner");
    const ownerEmail = String(ownerData.contactEmail || ownerData.email || "");
    const expiryIso = expiry.toISOString();

    transaction.update(ownerRef, {
      planName: plan.name,
      groundLimit,
      subscriptionStatus: "active",
      trialStartedAt: null,
      trialExpiresAt: null,
      subscriptionStartedAt: now.toISOString(),
      subscriptionExpiry: expiryIso,
      expiryDate: expiryIso,
      planAssignedAt: FieldValue.serverTimestamp(),
      planAssignedBy: "payment_gateway",
      planActivationMethod: "online_payment",
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(transactionRef, {
      txnId: String(txnId || providerPaymentId),
      ownerId,
      ownerName,
      ownerEmail,
      planId: plan.id,
      planName: plan.name,
      amount: numericAmount,
      currency: String(currency || "INR"),
      activationType: "Online Payment",
      paymentMethod: String(provider),
      paymentProvider: String(provider),
      providerOrderId: String(providerOrderId),
      providerPaymentId: String(providerPaymentId),
      status: "Paid",
      recordedBy: "payment_gateway",
      createdAt: FieldValue.serverTimestamp(),
      verifiedAt: FieldValue.serverTimestamp()
    });
    return { alreadyProcessed: false, expiryDate: expiryIso };
  });
}


function bookingError(code, message) {
  throw new HttpsError(code, message);
}
function indiaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
function parseBookingTime(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return minute % 30 === 0 ? hour * 60 + minute : null;
}
function formatBookingTime(minutes) {
  const minuteOfDay = minutes % 1440, hour = Math.floor(minuteOfDay / 60), minute = minuteOfDay % 60;
  return (hour % 12 || 12) + ":" + String(minute).padStart(2,"0") + (hour >= 12 ? " PM" : " AM");
}

exports.createBooking = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) bookingError("unauthenticated", "Please sign in before creating a booking.");
  const input = request.data || {};
  const groundId = typeof input.groundId === "string" ? input.groundId.trim() : "";
  const date = typeof input.date === "string" ? input.date : "";
  const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!groundId || groundId.length > 180 || !/^[A-Za-z0-9_-]+$/.test(groundId)) bookingError("invalid-argument", "Select a valid ground.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bookingError("invalid-argument", "Choose a valid booking date.");
  const dateObject = new Date(date + "T00:00:00.000Z");
  if (Number.isNaN(dateObject.getTime()) || dateObject.toISOString().slice(0,10) !== date || date < indiaDateString()) {
    bookingError("invalid-argument", "Choose today or a future booking date.");
  }
  if (!customerName || customerName.length > 80 || !/^[0-9]{10}$/.test(phone)) bookingError("invalid-argument", "Enter a valid customer name and 10-digit mobile number.");
  const startRaw = parseBookingTime(input.startTime), endRaw = parseBookingTime(input.endTime);
  if (startRaw === null || endRaw === null) bookingError("invalid-argument", "Booking times must use valid 30-minute intervals.");
  let start = startRaw, end = endRaw;
  if (startRaw < 180) { start += 1440; end += 1440; }
  else if (endRaw <= startRaw) end += 1440;
  const duration = end - start;
  if (start < 480 || end > 1620 || duration <= 0 || duration > 480) bookingError("invalid-argument", "Choose a valid time between 8:00 AM and 3:00 AM, up to 8 hours.");

  const db = getFirestore(), groundRef = db.collection("grounds").doc(groundId);
  const groundSnapshot = await groundRef.get();
  if (!groundSnapshot.exists) bookingError("not-found", "This ground is no longer available.");
  const ground = groundSnapshot.data() || {}, ownerUid = String(ground.ownerUid || "").trim();
  if (!ownerUid || ground.isActive === false) bookingError("failed-precondition", "This ground is currently unavailable for booking.");
  const requestedMode = input.bookingMode === "owner" ? "owner" : "customer";
  const isOwnerBooking = requestedMode === "owner";
  if (isOwnerBooking && request.auth.uid !== ownerUid) bookingError("permission-denied", "Only the ground owner can create an owner dashboard booking.");
  if (!isOwnerBooking && request.auth.token.superAdmin === true) bookingError("permission-denied", "A Super Admin session cannot submit a customer booking.");
  const weekday = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][dateObject.getUTCDay()];
  if (ground.availability && ground.availability[weekday] && ground.availability[weekday].open === false) bookingError("failed-precondition", "This ground is closed on the selected date.");
  const hourlyPrice = Number(ground.price);
  if (!Number.isFinite(hourlyPrice) || hourlyPrice <= 0) bookingError("failed-precondition", "This ground does not have a valid booking price.");

  const bookingRef = db.collection("bookings").doc(), bookingId = bookingRef.id;
  const createdAt = Date.now(), holdExpiresAt = isOwnerBooking ? 0 : createdAt + 30 * 60 * 1000;
  const slotEntries = [];
  for (let minute = start; minute < end; minute += 30) {
    const day = new Date(date + "T00:00:00.000Z");
    day.setUTCDate(day.getUTCDate() + Math.floor(minute / 1440));
    const dateKey = day.toISOString().slice(0,10), minuteOfDay = minute % 1440;
    slotEntries.push({slotId:encodeURIComponent(groundId)+"_"+dateKey+"_"+String(minuteOfDay).padStart(4,"0"),date:dateKey,minute:minuteOfDay});
  }
  const booking = {
    id:bookingId, groundId, groundName:String(ground.name || ground.groundName || "Sports Ground"),
    owner:String(ground.owner || ground.ownerEmail || ""), ownerUid, customerName, phone, date,
    slot:formatBookingTime(start)+" - "+formatBookingTime(end), startTime:input.startTime, endTime:input.endTime,
    amount:Math.round(hourlyPrice*duration/60), status:isOwnerBooking?"Confirmed":"Pending",
    paymentStatus:isOwnerBooking?"Pay at venue":"Awaiting payment",
    bookingSource:isOwnerBooking?"Owner dashboard":"Main website", createdAt, holdExpiresAt,
    slotIds:slotEntries.map(item=>item.slotId)
  };
  if (!isOwnerBooking) booking.customerUid = request.auth.uid;
  await db.runTransaction(async transaction => {
    const slotRefs = slotEntries.map(item=>db.collection("bookingSlots").doc(item.slotId));
    const snapshots = await Promise.all(slotRefs.map(ref=>transaction.get(ref)));
    const now = Date.now();
    if (snapshots.some(snapshot=>{
      if(!snapshot.exists)return false;
      const existing=snapshot.data()||{};
      return !(existing.status==="Pending" && Number(existing.holdExpiresAt||0)<=now);
    })) bookingError("already-exists","This time slot is already booked. Please choose another time.");
    transaction.create(bookingRef,{...booking,updatedAt:FieldValue.serverTimestamp()});
    slotEntries.forEach((item,index)=>transaction.set(slotRefs[index],{
      bookingId,groundId,ownerUid,date:item.date,minute:item.minute,status:booking.status,
      holdExpiresAt,updatedAt:FieldValue.serverTimestamp()
    }));
  });
  return {bookingId,amount:booking.amount,status:booking.status,paymentStatus:booking.paymentStatus,
    bookingSource:booking.bookingSource,customerUid:booking.customerUid||null,createdAt,holdExpiresAt,
    slotIds:booking.slotIds};
});

exports.createOwnerDashboardSession = onCall(
  {
    cors: [
      "https://boxbookindia.web.app",
      "https://box-book-india-5183f.web.app",
      "http://127.0.0.1:8080",
      "http://localhost:8080"
    ]
  },
  async (request) => {
    if (!request.auth || request.auth.token.superAdmin !== true) {
      throw new HttpsError("permission-denied", "Only an authenticated Super Admin can open an owner session.");
    }

    const ownerUid = request.data && request.data.ownerUid;
    if (typeof ownerUid !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(ownerUid)) {
      throw new HttpsError("invalid-argument", "A valid owner account is required.");
    }

    const ownerRef = getFirestore().collection("owners").doc(ownerUid);
    const [ownerSnapshot, ownerUser] = await Promise.all([
      ownerRef.get(),
      getAuth().getUser(ownerUid).catch(() => null)
    ]);

    if (!ownerSnapshot.exists || !ownerUser || ownerUser.disabled || !ownerUser.email) {
      throw new HttpsError("not-found", "This owner account is unavailable.");
    }
    if (ownerUser.customClaims && ownerUser.customClaims.superAdmin === true) {
      throw new HttpsError("failed-precondition", "An administrator account cannot be opened as an owner.");
    }

    try {
      const customToken = await getAuth().createCustomToken(ownerUid, {
        adminOwnerSession: true,
        initiatedBy: request.auth.uid
      });
      return { customToken };
    } catch (error) {
      console.error("Could not create an owner session token:", error);
      throw new HttpsError("internal", "The owner session could not be created. Check the function service account permissions.");
    }
  }
);

exports.updateOwnerLoginEmail = onCall(async (request) => {
  if (
    !request.auth
    || request.auth.token.superAdmin !== true
    || String(request.auth.token.email || "").toLowerCase() !== "tusharjotva44@gmail.com"
  ) {
    throw new HttpsError("permission-denied", "Only the authorized Super Admin can change an owner login email.");
  }

  const ownerUid = request.data && request.data.ownerUid;
  const email = String(request.data && request.data.email || "").trim().toLowerCase();
  if (typeof ownerUid !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(ownerUid)) {
    throw new HttpsError("invalid-argument", "A valid owner account is required.");
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }

  const auth = getAuth();
  const ownerRef = getFirestore().collection("owners").doc(ownerUid);
  const ownerSnapshot = await ownerRef.get();
  if (!ownerSnapshot.exists) {
    throw new HttpsError("not-found", "The owner profile could not be found.");
  }

  let ownerUser;
  try {
    ownerUser = await auth.getUser(ownerUid);
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      throw new HttpsError("not-found", "The owner's Firebase Authentication account could not be found.");
    }
    throw new HttpsError("internal", "The owner account could not be checked.");
  }

  if (ownerUser.customClaims && ownerUser.customClaims.superAdmin === true) {
    throw new HttpsError("failed-precondition", "A Super Admin login email cannot be changed from Owner Management.");
  }

  const previousEmail = ownerUser.email || "";
  const emailChanged = previousEmail.toLowerCase() !== email;
  let authEmailUpdated = false;
  try {
    if (emailChanged) {
      await auth.updateUser(ownerUid, { email, emailVerified: false });
      authEmailUpdated = true;
    }
    await ownerRef.update({
      email,
      contactEmail: email,
      updatedAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    if (authEmailUpdated && previousEmail) {
      try {
        await auth.updateUser(ownerUid, {
          email: previousEmail,
          emailVerified: ownerUser.emailVerified
        });
      } catch (rollbackError) {
        console.error("Owner email rollback failed:", rollbackError);
      }
    }
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "This email is already used by another Firebase account.");
    }
    if (error.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Enter a valid email address.");
    }
    console.error("Could not update owner login email:", error);
    throw new HttpsError("internal", "The owner login email could not be updated.");
  }

  return { email, emailChanged };
});


// Persist a server-side notification whenever a customer submits a new booking.
exports.notifyOwnerOnNewBooking = onDocumentCreated("bookings/{bookingId}", async (event) => {
  const booking = event.data && event.data.data();
  if (!booking || booking.bookingSource !== "Main website" || booking.notificationSuppressed === true) return;

  const ownerUid = String(booking.ownerUid || "").trim();
  if (!ownerUid) {
    console.warn("Booking notification skipped: ownerUid is missing.", event.params.bookingId);
    return;
  }

  const bookingId = String(event.params.bookingId || "");
  const safeBookingId = bookingId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)
    || String(event.id).replace(/[^A-Za-z0-9_-]/g, "_");
  const notificationRef = getFirestore()
    .collection("ownerNotifications")
    .doc(ownerUid)
    .collection("items")
    .doc(safeBookingId + "_new_booking");

  try {
    await notificationRef.create({
      ownerUid,
      bookingId,
      type: "booking_created",
      title: "New booking request",
      message: [
        String(booking.customerName || "Customer"),
        String(booking.groundName || "Ground"),
        String(booking.date || ""),
        String(booking.slot || "")
      ].filter(Boolean).join(" · "),
      status: String(booking.status || "Pending"),
      read: false,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    if (error && (error.code === 6 || error.code === "already-exists")) return;
    throw error;
  }
});
