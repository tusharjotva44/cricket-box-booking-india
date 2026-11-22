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



function ownerPlanGroundAccess(owner) {
  const status = String(owner.subscriptionStatus || "").trim().toLowerCase();
  const expiryValue = status === "trial"
    ? owner.trialExpiresAt
    : (owner.subscriptionExpiry || owner.expiryDate);
  const expiryTime = expiryValue && typeof expiryValue.toDate === "function"
    ? expiryValue.toDate().getTime()
    : Date.parse(String(expiryValue || ""));
  const subscriptionActive = ["trial", "active", "paid"].includes(status)
    && Number.isFinite(expiryTime)
    && expiryTime > Date.now();

  const configuredLimit = Number(owner.groundLimit);
  const groundLimit = Number.isInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : (status === "trial" && String(owner.planName || "").toLowerCase().startsWith("free trial") ? 1 : 0);
  return { subscriptionActive, groundLimit };
}

// Owner profiles are created by trusted server code so clients cannot assign
// themselves a paid plan, extend a trial, or increase their ground allowance.
exports.createOwnerProfile = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Please sign in before creating your owner profile.");
  }

  const fullName = String(request.data && request.data.fullName || "").trim();
  const mobile = String(request.data && request.data.mobile || "").trim();
  const email = String(request.auth.token.email || "").trim().toLowerCase();
  if (!fullName || fullName.length > 80 || !/^[0-9]{10}$/.test(mobile) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid name, email address and 10-digit mobile number.");
  }

  const ownerRef = getFirestore().collection("owners").doc(request.auth.uid);
  const existing = await ownerRef.get();
  if (existing.exists) {
    const existingEmail = String((existing.data() || {}).email || "").trim().toLowerCase();
    if (existingEmail && existingEmail !== email) {
      throw new HttpsError("already-exists", "An owner profile already exists for this account. Please contact support.");
    }
    return { created: false };
  }

  const now = new Date();
  const trialExpiry = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
  await ownerRef.create({
    fullName,
    mobile,
    email,
    planName: "Free Trial - 1 Ground",
    groundLimit: 1,
    groundCount: 0,
    subscriptionStatus: "trial",
    trialStartedAt: now.toISOString(),
    trialExpiresAt: trialExpiry.toISOString(),
    planAssignedBy: "system_trial_signup",
    planActivationMethod: "automatic_signup",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { created: true, planName: "Free Trial - 1 Ground", groundLimit: 1, trialExpiresAt: trialExpiry.toISOString() };
});

// All owner ground writes pass through this function. The server checks the
// current subscription and ground allowance before saving the requested list.
exports.saveOwnerGrounds = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Please sign in before saving your grounds.");
  }

  const ownerUid = request.auth.uid;
  const requestedGrounds = request.data && request.data.grounds;
  if (!Array.isArray(requestedGrounds) || requestedGrounds.length > 100) {
    throw new HttpsError("invalid-argument", "The ground list is invalid.");
  }

  const ids = requestedGrounds.map(ground => String(ground && ground.id || "").trim());
  if (ids.some(id => !/^[A-Za-z0-9_-]{1,180}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new HttpsError("invalid-argument", "Every ground must have a unique valid ID.");
  }

  const db = getFirestore();
  const ownerRef = db.collection("owners").doc(ownerUid);
  const groundsRef = db.collection("grounds");
  let owner = {};
  let ownerEmail = "";
  let groundLimit = 0;

  await db.runTransaction(async transaction => {
    const ownerSnapshot = await transaction.get(ownerRef);
    if (!ownerSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Your owner profile could not be found. Please contact support.");
    }
    owner = ownerSnapshot.data() || {};
    const planAccess = ownerPlanGroundAccess(owner);
    groundLimit = planAccess.groundLimit;
    ownerEmail = String(owner.contactEmail || owner.email || request.auth.token.email || "").trim().toLowerCase();

    const existingSnapshot = await transaction.get(groundsRef.where("ownerUid", "==", ownerUid));
    const existingIds = new Set(existingSnapshot.docs.map(item => item.id));
    const requestedRefs = requestedGrounds.map(ground => groundsRef.doc(String(ground.id)));
    const requestedSnapshots = await Promise.all(requestedRefs.map(ref => transaction.get(ref)));
    const requestedIdSet = new Set(ids);

    if (planAccess.subscriptionActive) {
      if (!groundLimit) {
        throw new HttpsError("failed-precondition", "Your plan does not have a valid ground limit. Please contact Super Admin.");
      }
      if (requestedGrounds.length > groundLimit) {
        throw new HttpsError("resource-exhausted", "Your current plan allows up to " + groundLimit + (groundLimit === 1 ? " ground." : " grounds."));
      }
    } else if (ids.some(id => !existingIds.has(id))) {
      // Expired or inactive owners may still edit or remove existing grounds,
      // but cannot add new grounds until their subscription is renewed.
      throw new HttpsError("failed-precondition", "Your subscription is inactive or expired. Renew your plan before adding a ground.");
    }

    for (let index = 0; index < requestedSnapshots.length; index += 1) {
      if (requestedSnapshots[index].exists &&
          String((requestedSnapshots[index].data() || {}).ownerUid || "") !== ownerUid) {
        throw new HttpsError("already-exists", "A ground with this ID belongs to another owner.");
      }
    }

    for (const existingGround of existingSnapshot.docs) {
      if (!requestedIdSet.has(existingGround.id)) transaction.delete(existingGround.ref);
    }
    requestedGrounds.forEach((ground, index) => {
      const { id, ...data } = ground;
      transaction.set(requestedRefs[index], {
        ...data,
        ownerUid,
        owner: ownerEmail,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    // A write to the owner document serializes concurrent ground-save requests.
    transaction.update(ownerRef, {
      groundCount: requestedGrounds.length,
      groundCountUpdatedAt: FieldValue.serverTimestamp()
    });
  });

  const activity = request.data && request.data.activity;
  if (activity && typeof activity === "object") {
    try {
      await db.collection("ownerActivityLogs").add({
        ownerUid,
        ownerEmail,
        ownerName: String(owner.fullName || "Owner"),
        actorUid: ownerUid,
        actorEmail: String(request.auth.token.email || ownerEmail),
        actorName: String(activity.actorName || owner.fullName || "Owner"),
        activityType: String(activity.activityType || ""),
        groundId: String(activity.groundId || ""),
        groundName: String(activity.groundName || "Sports Ground"),
        sport: String(activity.sport || ""),
        location: String(activity.location || ""),
        createdAt: FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error("Owner Activity Log could not be saved:", error);
    }
  }

  return { savedCount: requestedGrounds.length, groundLimit, subscriptionActive: ownerPlanGroundAccess(owner).subscriptionActive };
});

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
  if (!isOwnerBooking && (
    String(request.auth.token.email || "").toLowerCase() !== "niklo12@gmail.com"
    || request.auth.token.firebase?.sign_in_provider !== "password"
  )) bookingError("permission-denied", "Please sign in with the authorized customer email and password account to create a booking.");
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

// Create a trusted, immutable snapshot of an owner's selected paid plan.
exports.createOwnerPlanRequest = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Please sign in before requesting a subscription plan.");
  }
  const ownerId = request.auth.uid;
  const planId = String(request.data && request.data.planId || "").trim();
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(planId)) {
    throw new HttpsError("invalid-argument", "Choose a valid subscription plan.");
  }

  const db = getFirestore();
  const ownerRef = db.collection("owners").doc(ownerId);
  const planRef = db.collection("subscriptionPlans").doc(planId);
  const [ownerSnapshot, planSnapshot] = await Promise.all([ownerRef.get(), planRef.get()]);
  if (!ownerSnapshot.exists) throw new HttpsError("failed-precondition", "Your owner profile could not be found.");
  if (!planSnapshot.exists) throw new HttpsError("not-found", "The selected subscription plan was not found.");

  const plan = planSnapshot.data() || {};
  if (plan.active === false || plan.kind === "trial") {
    throw new HttpsError("failed-precondition", "Only an active paid plan can be requested.");
  }
  const durationValue = Number(plan.durationValue || 1);
  const durationUnit = String(plan.durationUnit || "months");
  const groundLimit = Number(plan.grounds || 1);
  const basePrice = Number(plan.price);
  const discount = Number(plan.discount || 0);
  const amount = Math.round(basePrice * (1 - discount / 100) * 100) / 100;
  if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 120
      || !["days", "months", "years"].includes(durationUnit)
      || !Number.isInteger(groundLimit) || groundLimit < 1 || groundLimit > 100
      || !Number.isFinite(basePrice) || basePrice <= 0
      || !Number.isFinite(discount) || discount < 0 || discount > 100
      || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("failed-precondition", "The selected plan has invalid price or duration settings.");
  }

  const owner = ownerSnapshot.data() || {};
  const requestRef = ownerRef.collection("purchaseHistory").doc();
  await requestRef.create({
    ownerUid: ownerId,
    ownerEmail: String(request.auth.token.email || owner.email || "").trim().toLowerCase(),
    ownerName: String(owner.fullName || "Owner"),
    planId,
    planName: String(plan.name || "Subscription"),
    amount,
    planSnapshot: { name: String(plan.name || "Subscription"), durationValue, durationUnit, groundLimit, amount },
    source: "Owner Dashboard",
    status: "Pending",
    createdAt: FieldValue.serverTimestamp()
  });
  return { requestId: requestRef.id, amount, status: "Pending" };
});

exports.reviewOwnerPlanRequest = onCall(async (request) => {
  if (!request.auth
      || request.auth.token.superAdmin !== true
      || String(request.auth.token.email || "").trim().toLowerCase() !== "tusharjotva44@gmail.com") {
    throw new HttpsError("permission-denied", "Only the authorized Super Admin can review plan requests.");
  }

  const ownerId = String(request.data && request.data.ownerId || "").trim();
  const requestId = String(request.data && request.data.requestId || "").trim();
  const action = String(request.data && request.data.action || "").trim().toLowerCase();
  const txnId = String(request.data && request.data.txnId || "").trim();
  const reviewNote = String(request.data && request.data.reviewNote || "").trim().slice(0, 500);
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(ownerId) || !/^[A-Za-z0-9_-]{1,180}$/.test(requestId)) {
    throw new HttpsError("invalid-argument", "A valid owner and purchase request are required.");
  }
  if (!["approve", "reject"].includes(action)) {
    throw new HttpsError("invalid-argument", "Choose approve or reject.");
  }
  if (action === "approve" && (!txnId || txnId.length > 120 || !/^[A-Za-z0-9._/-]+$/.test(txnId))) {
    throw new HttpsError("invalid-argument", "Enter a valid payment transaction ID.");
  }

  const db = getFirestore();
  const ownerRef = db.collection("owners").doc(ownerId);
  const requestRef = ownerRef.collection("purchaseHistory").doc(requestId);
  const requestSnapshot = await requestRef.get();
  if (!requestSnapshot.exists) throw new HttpsError("not-found", "The purchase request was not found.");
  const purchase = requestSnapshot.data() || {};
  if (purchase.ownerUid !== ownerId) throw new HttpsError("permission-denied", "The purchase request owner does not match.");
  if (String(purchase.status || "").toLowerCase() !== "pending") {
    throw new HttpsError("failed-precondition", "This purchase request has already been reviewed.");
  }

  if (action === "reject") {
    await db.runTransaction(async transaction => {
      const latestRequest = await transaction.get(requestRef);
      if (!latestRequest.exists || latestRequest.data().ownerUid !== ownerId) {
        throw new HttpsError("not-found", "The purchase request was not found.");
      }
      if (String(latestRequest.data().status || "").toLowerCase() !== "pending") {
        throw new HttpsError("failed-precondition", "This purchase request has already been reviewed.");
      }
      transaction.update(requestRef, {
        status: "Rejected",
        reviewNote,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: request.auth.token.email
      });
    });
    return { status: "Rejected" };
  }

  let plan = purchase.planSnapshot && typeof purchase.planSnapshot === "object" ? {
    name: purchase.planSnapshot.name,
    durationValue: purchase.planSnapshot.durationValue,
    durationUnit: purchase.planSnapshot.durationUnit,
    grounds: purchase.planSnapshot.groundLimit
  } : null;
  let amount = Number(purchase.planSnapshot && purchase.planSnapshot.amount);
  if (!plan || !Number.isFinite(amount) || amount <= 0) {
    // Backward compatibility for pending requests created before trusted snapshots.
    const planRef = db.collection("subscriptionPlans").doc(String(purchase.planId || ""));
    const planSnapshot = await planRef.get();
    if (!planSnapshot.exists) throw new HttpsError("not-found", "The requested subscription plan no longer exists.");
    const currentPlan = planSnapshot.data() || {};
    if (currentPlan.active === false || currentPlan.kind === "trial") {
      throw new HttpsError("failed-precondition", "Only an active paid subscription plan can be approved.");
    }
    const basePrice = Number(currentPlan.price);
    const discount = Number(currentPlan.discount || 0);
    amount = Math.round(basePrice * (1 - discount / 100) * 100) / 100;
    plan = {
      name: currentPlan.name,
      durationValue: currentPlan.durationValue || 1,
      durationUnit: currentPlan.durationUnit || "months",
      grounds: currentPlan.grounds || 1
    };
  }
  const durationValue = Number(plan.durationValue || 1);
  const durationUnit = String(plan.durationUnit || "months");
  const groundLimit = Number(plan.grounds || 1);
  if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 120
      || !["days", "months", "years"].includes(durationUnit)
      || !Number.isInteger(groundLimit) || groundLimit < 1 || groundLimit > 100
      || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("failed-precondition", "The saved subscription plan details are invalid.");
  }

  const safeTxnId = txnId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  const transactionRef = db.collection("transactionHistory").doc("manual_" + safeTxnId);
  const now = new Date();
  const expiry = new Date(now);
  if (durationUnit === "days") expiry.setDate(expiry.getDate() + durationValue);
  else if (durationUnit === "years") expiry.setFullYear(expiry.getFullYear() + durationValue);
  else expiry.setMonth(expiry.getMonth() + durationValue);
  const expiryIso = expiry.toISOString();

  await db.runTransaction(async transaction => {
    const [ownerSnapshot, latestRequest, existingTransaction] = await Promise.all([
      transaction.get(ownerRef),
      transaction.get(requestRef),
      transaction.get(transactionRef)
    ]);
    if (!ownerSnapshot.exists) throw new HttpsError("not-found", "The owner profile was not found.");
    if (!latestRequest.exists || String(latestRequest.data().status || "").toLowerCase() !== "pending") {
      throw new HttpsError("failed-precondition", "This purchase request has already been reviewed.");
    }
    if (existingTransaction.exists) throw new HttpsError("already-exists", "This transaction ID has already been recorded.");
    const owner = ownerSnapshot.data() || {};
    transaction.update(ownerRef, {
      planName: String(plan.name || "Subscription"),
      groundLimit,
      subscriptionStatus: "active",
      trialStartedAt: null,
      trialExpiresAt: null,
      subscriptionStartedAt: now.toISOString(),
      subscriptionExpiry: expiryIso,
      expiryDate: expiryIso,
      planAssignedAt: FieldValue.serverTimestamp(),
      planAssignedBy: request.auth.token.email,
      planActivationMethod: "manual_payment_verification",
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.update(requestRef, {
      status: "Paid",
      source: "Super Admin",
      amount,
      txnId,
      reviewNote,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: request.auth.token.email
    });
    transaction.create(transactionRef, {
      txnId,
      ownerId,
      ownerName: String(owner.fullName || "Owner"),
      ownerEmail: String(owner.email || owner.contactEmail || purchase.ownerEmail || ""),
      planId: String(purchase.planId),
      planName: String(plan.name || "Subscription"),
      amount,
      currency: "INR",
      activationType: "Manual Payment Verification",
      paymentMethod: "Manually verified",
      paymentProvider: null,
      providerOrderId: null,
      providerPaymentId: null,
      status: "Success",
      recordedBy: request.auth.token.email,
      createdAt: FieldValue.serverTimestamp(),
      verifiedAt: FieldValue.serverTimestamp()
    });
  });
  return { status: "Paid", expiryDate: expiryIso };
});

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
