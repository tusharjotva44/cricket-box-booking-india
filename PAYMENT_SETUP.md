# Box Book India — payment backend (initial)

This branch adds a separate Node.js API for server-side Razorpay order creation, signature verification, webhook validation, and slot holds. Existing HTML/CSS and customer-facing design are intentionally unchanged.

## Run locally

1. Install Node.js 20 or newer.
2. In this folder run `npm install`.
3. Copy `.env.example` to `.env` and add Razorpay **test-mode** credentials.
4. Run `npm start`; check `http://localhost:3000/api/health`.

Configure a Razorpay webhook pointing to `https://YOUR_API_HOST/api/payments/webhook` and subscribe to `payment.captured`, `payment.failed` (and optionally `order.paid`). Set the webhook secret in `RAZORPAY_WEBHOOK_SECRET`.

## API endpoints

- `GET /api/health` — API readiness.
- `POST /api/payments/create-order` — body: `{ "groundId", "date", "slot", "customerName", "customerPhone" }`. Amount is read from the server database, not the browser.
- `POST /api/payments/verify` — verifies Razorpay checkout signature and confirms a booking while the slot hold is valid.
- `POST /api/payments/webhook` — verifies the webhook HMAC signature and processes captured/failed payments.
- `GET /api/bookings/:id/status` — returns the current status for a booking ID.

SQLite tables are created automatically. The API intentionally refuses to create an order unless the ground exists in its server-side `grounds` table. Existing browser `localStorage` grounds are not automatically trusted or copied into the payment database.

## Important limits before launch

- This is backend groundwork; the existing browser checkout is not wired to these endpoints yet, so the current website does not start taking gateway payments just by adding these files.
- The initial implementation creates orders on the platform Razorpay account. It does **not** yet onboard each owner as a Razorpay Route linked account or split/settle funds directly to owners. That requires Razorpay Route approval, owner KYC/onboarding, a verified linked-account ID per owner, and a further integration step.
- The current demo owner login is browser-only and is not secure authentication. Do not expose owner/admin write endpoints or real credentials until server-side authentication and authorization are in place.
- Use test mode until payment success/failure, webhook retries, expired holds, duplicate slot attempts, and refunds are tested. Keep `.env` and the SQLite database out of source control.
