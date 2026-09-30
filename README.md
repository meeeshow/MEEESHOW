# Meeeshow — Actual Full-Stack Starter

## What this is
A real Node.js + Express + SQLite e-commerce application, not just a static mockup.

Included:
- Customer storefront
- Product search and categories
- Persistent SQLite product database
- Shopping cart
- Order creation
- Admin authentication
- Admin product CRUD
- Admin order list/status management
- Sales/product/order dashboard
- Razorpay integration endpoints (requires your own credentials)
- COD is intentionally not implemented

## Run locally
1. Install Node.js 20+.
2. Open a terminal in this folder.
3. Copy `.env.example` to `.env`.
4. Change `SESSION_SECRET` and `ADMIN_PASSWORD`.
5. Run:
   npm install
   npm start
6. Open:
   http://localhost:3000
7. Admin:
   http://localhost:3000/admin.html

## Live payments
Set these in `.env`:
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...

The code creates Razorpay orders and verifies the signature server-side. You still need to add the Razorpay checkout script/UI and your production webhook/refund flows before accepting real customer payments.

## Production requirements
Before launch, deploy behind HTTPS, use a production session store, secure cookies, a strong secret/password, rate limiting, backups, proper image storage, privacy/terms/returns pages, shipping/tax/invoice logic, payment webhooks, refund handling, and monitoring.
