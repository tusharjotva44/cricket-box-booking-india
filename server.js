require("dotenv").config();

const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const Razorpay = require("razorpay");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || "./boxbook.sqlite";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://127.0.0.1:8080";

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn("Razorpay keys are missing. Payment endpoints will return 503 until configured.");
}

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS grounds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_per_hour_paise INTEGER NOT NULL CHECK(price_per_hour_paise > 0),
    owner_razorpay_account_id TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    ground_id TEXT NOT NULL REFERENCES grounds(id),
    booking_date TEXT NOT NULL,
    slot TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
    razorpay_order_id TEXT UNIQUE,
    razorpay_payment_id TEXT UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed','expired')),
    hold_expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_live_booking_per_slot
    ON bookings(ground_id, booking_date, slot)
    WHERE status IN ('pending','confirmed');
  CREATE TABLE IF NOT EXISTS payment_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    received_at INTEGER NOT NULL
  );
`);

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: FRONTEND_ORIGIN.split(",").map((value) => value.trim()), methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "X-Razorpay-Signature"] }));

// Webhooks need the exact raw request bytes for signature validation.
app.post("/api/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.get("X-Razorpay-Signature");
  if (!secret || !signature || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Webhook signature is not configured or missing." });

  const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return res.status(400).json({ error: "Invalid webhook signature." });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload." });
  }

  const eventId = req.get("x-razorpay-event-id") || crypto.createHash("sha256").update(req.body).digest("hex");
  const saveEvent = db.prepare("INSERT OR IGNORE INTO payment_events(event_id,event_type,received_at) VALUES(?,?,?)");
  const updateBooking = db.prepare(`
    UPDATE bookings SET status='confirmed', razorpay_payment_id=?
    WHERE razorpay_order_id=? AND status='pending' AND hold_expires_at > ?
  `);
  const failBooking = db.prepare(`
    UPDATE bookings SET status='failed'
    WHERE razorpay_order_id=? AND status='pending'
  `);

  const tx = db.transaction(() => {
    const inserted = saveEvent.run(eventId, String(event.event || "unknown"), Date.now());
    if (!inserted.changes) return;
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const payment = event.payload && event.payload.payment && event.payload.payment.entity;
      const order = event.payload && event.payload.order && event.payload.order.entity;
      const orderId = payment?.order_id || order?.id;
      if (orderId) updateBooking.run(payment?.id || null, orderId, Date.now());
    } else if (event.event === "payment.failed") {
      const payment = event.payload && event.payload.payment && event.payload.payment.entity;
      if (payment?.order_id) failBooking.run(payment.order_id);
    }
  });
  tx();
  return res.json({ received: true });
});

app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "box-book-india-payments", gatewayConfigured: Boolean(razorpay) });
});

app.post("/api/payments/create-order", async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: "Payment gateway is not configured yet." });

  const { groundId, date, slot, customerName, customerPhone } = req.body || {};
  if (![groundId, date, slot, customerName, customerPhone].every((value) => typeof value === "string" && value.trim())) {
    return res.status(400).json({ error: "Ground, date, slot, customer name and phone are required." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{10}$/.test(customerPhone)) {
    return res.status(400).json({ error: "Use a valid date and 10-digit phone number." });
  }

  // Expire abandoned holds before checking availability.
  db.prepare("UPDATE bookings SET status='expired' WHERE status='pending' AND hold_expires_at <= ?").run(Date.now());
  const ground = db.prepare("SELECT id,name,price_per_hour_paise FROM grounds WHERE id=? AND active=1").get(groundId.trim());
  if (!ground) return res.status(404).json({ error: "Ground not found or unavailable in the payment database." });

  const bookingId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;
  const amount = Number(ground.price_per_hour_paise);
  try {
    const insertBooking = db.prepare(`
      INSERT INTO bookings(id,ground_id,booking_date,slot,customer_name,customer_phone,amount_paise,status,hold_expires_at,created_at)
      VALUES(?,?,?,?,?,?,?,'pending',?,?)
    `);
    insertBooking.run(bookingId, ground.id, date, slot.trim(), customerName.trim().slice(0,100), customerPhone, amount, expiresAt, now);
  } catch (error) {
    if (String(error.code || "").startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "This slot is already booked or temporarily held." });
    }
    console.error("Could not reserve slot:", error.message);
    return res.status(500).json({ error: "Could not reserve this slot." });
  }

  try {
    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: bookingId,
      notes: { booking_id: bookingId, ground_id: ground.id, booking_date: date, slot: slot.trim() }
    });
    db.prepare("UPDATE bookings SET razorpay_order_id=? WHERE id=?").run(order.id, bookingId);
    return res.status(201).json({
      bookingId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      expiresAt
    });
  } catch (error) {
    db.prepare("UPDATE bookings SET status='failed' WHERE id=? AND status='pending'").run(bookingId);
    console.error("Razorpay order creation failed:", error.message);
    return res.status(502).json({ error: "Payment order could not be created. Please try again." });
  }
});

app.post("/api/payments/verify", async (req, res) => {
  if (!razorpay || !process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ error: "Payment gateway is not configured yet." });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (![orderId, paymentId, signature].every((value) => typeof value === "string" && value)) {
    return res.status(400).json({ error: "Missing payment verification fields." });
  }

  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(orderId + "|" + paymentId).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: "Payment signature is invalid. Booking was not confirmed." });
  }

  try {
    const payment = await razorpay.payments.fetch(paymentId);
    if (payment.order_id !== orderId || payment.amount <= 0 || payment.status !== "captured") {
      return res.status(400).json({ error: "Payment is not captured for this order. Booking was not confirmed." });
    }

    const tx = db.transaction(() => {
      const booking = db.prepare("SELECT id,status,hold_expires_at,amount_paise FROM bookings WHERE razorpay_order_id=?").get(orderId);
      if (!booking) return { status: "missing" };
      if (Number(payment.amount) !== Number(booking.amount_paise)) return { status: "amount_mismatch" };
      if (booking.status === "confirmed") return { status: "confirmed", bookingId: booking.id };
      if (booking.status !== "pending" || booking.hold_expires_at <= Date.now()) {
        if (booking.status === "pending") db.prepare("UPDATE bookings SET status='expired' WHERE id=?").run(booking.id);
        return { status: "expired" };
      }
      const result = db.prepare("UPDATE bookings SET status='confirmed',razorpay_payment_id=? WHERE id=? AND status='pending'").run(paymentId, booking.id);
      return result.changes ? { status: "confirmed", bookingId: booking.id } : { status: "conflict" };
    });
    const result = tx();
    if (result.status === "confirmed") return res.json({ success: true, bookingId: result.bookingId, status: "confirmed" });
    if (result.status === "missing") return res.status(404).json({ error: "Booking not found." });
    if (result.status === "amount_mismatch") return res.status(400).json({ error: "Payment amount does not match the booking." });
    return res.status(409).json({ error: "Slot hold expired or booking state changed. Contact support if payment was collected." });
  } catch (error) {
    console.error("Payment verification failed:", error.message);
    return res.status(502).json({ error: "Could not verify payment with Razorpay. Booking was not confirmed." });
  }
});

app.get("/api/bookings/:id/status", (req, res) => {
  const booking = db.prepare("SELECT id,status,ground_id,booking_date,slot,amount_paise FROM bookings WHERE id=?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  res.json({ booking });
});

app.listen(PORT, () => {
  console.log(`Box Book India payment API listening on port ${PORT}`);
});
