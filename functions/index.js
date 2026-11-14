const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

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
