const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();
setGlobalOptions({ region: "asia-south1", maxInstances: 3 });

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
  if (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
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
