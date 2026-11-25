# TapNex — NFC Smart Business Card SaaS Platform

TapNex is a full-stack NFC smart business card and digital business profile SaaS platform built with **React 19, TypeScript, Tailwind CSS v4, Express (`server.ts`), Firebase (Auth, Firestore, Storage, Cloud Functions), Razorpay, Resend, QRCode, and jsPDF**.

---

## Core Capabilities

- **Public Website & Mobile Digital Profile (`/p/:slug`)**: Responsive marketing site and public smart card profile page accessible without login for NFC chip taps and QR scans, featuring one-tap Call, WhatsApp, Email, Website, native Share, and **vCard (`.vcf`)** contact download.
- **Strict Field-Level Privacy**: `profiles/{profileId}` remains private to the owner/admins. Only fields explicitly marked visible in `visibilitySettings` are projected into `publicProfiles/{slug}`.
- **85.6 × 54 mm Print Card Design Studio**: Supports landscape and vertical orientations, 8 curated templates, front/back custom text, fonts, colors, logo/photo upload, and a **non-scannable `"QR CODE"` placeholder** prior to payment.
- **Post-Payment QR & 300 DPI Print PDF Pipeline**: Actual QR codes (Error Correction `H`, 4-module quiet zone) are generated server-side **only after verified Razorpay payment** (`payments/{orderId}` + HMAC-SHA256 verification). Printers and Admins can download exact **300 DPI `85.6 × 54 mm` + `3 mm` bleed (`91.6 × 60 mm`, `1082 × 709 px`)** front/back PDFs with crop marks.
- **Four Role-Separated Portals**:
  - **Customer Portal (`/dashboard/*`)** — Profiles, social links, custom fields, visibility controls, card design studio, Razorpay checkout, live order tracking, support tickets.
  - **Printer Portal (`/printer/*`)** — Assigned print queue, 300 DPI print PDF download, NFC URL encoding verification, and courier dispatch updates.
  - **Admin Portal (`/admin/*`)** — Analytics charts, user management (block/disable/delete), printer directory, order assignment, payment ledger, card templates, shipping records, CSV/Excel exports, email templates, and immutable audit logs.
  - **SuperAdmin Portal (`/superadmin/*`)** — Role assignments, granular admin permissions, direct custom-URL QR generator, pricing/GST/currency settings, customer QR view policy, and global feature flags.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, React Router v7, Tailwind CSS v4, Lucide Icons, Recharts, jsPDF, SheetJS (`xlsx`)
- **Backend / API**: Node.js + Express (`server.ts`) on port `3000`
- **Database & Security**: Cloud Firestore (`firebase-applet-config.json` + audited `firestore.rules`), Firebase Auth (Google + Email/Password), Firebase Cloud Functions (`/functions/src/index.ts`), Firebase Storage (`storage.rules`)
- **Payments & Email**: Razorpay Orders & HMAC-SHA256 Verification, Resend Transactional Email API

---

## Local Setup & Installation

```bash
# 1. Install root dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
```

Fill in `.env` as needed:
- `APP_URL` — Public application origin (e.g., `http://localhost:3000` or your deployed URL)
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — Leave blank to run in explicit Razorpay Sandbox HMAC mode; provide live/test keys for live Razorpay Checkout
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — Resend transactional email credentials
- `SUPERADMIN_BOOTSTRAP_ENABLED`, `SUPERADMIN_INITIAL_USERNAME`, `SUPERADMIN_INITIAL_PASSWORD`, `SUPERADMIN_INITIAL_EMAIL` — Guarded one-time bootstrap variables (disable after initialization)

```bash
# 3. Start development server (Express API + Vite middleware on port 3000)
npm run dev
```

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start full-stack Express + Vite server on `http://localhost:3000` |
| `npm run build` | Build production frontend bundle to `/dist` |
| `npm run start` | Run production Express server serving `/dist` on port `3000` |
| `npm run typecheck` | Run TypeScript type check (`tsc --noEmit`) |
| `npm run lint` | Run TypeScript check and `@firebase/eslint-plugin-security-rules` on `firestore.rules` |
| `npm test` | Execute Vitest automated unit & security invariant suite (`vitest run`) |

---

## Firebase Configuration Checklist

1. **Authentication Providers**: In Firebase Console → Authentication → Sign-in method, ensure **Google** and **Email/Password** are enabled and add your localhost and production domains under **Authorized domains**.
2. **Firestore & Storage Rules**: Deploy rules cleanly via Firebase CLI:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
3. **Cloud Functions**:
   ```bash
   cd functions && npm install && npm run build && cd ..
   firebase deploy --only functions
   ```
4. **Firebase App Check**: Register reCAPTCHA v3 in Firebase Console → App Check for production abuse protection.

---

## Netlify Deployment

The repository includes `/netlify.toml` configured for SPA routing:
- **Build command**: `npm run build`
- **Publish directory**: `dist`
- **Redirect**: `/* -> /index.html (200)`

If hosting backend endpoints (`/api/*`) alongside frontend on Node hosting (Cloud Run / Railway / Render), use:
- **Build command**: `npm install && npm run build`
- **Start command**: `NODE_ENV=production npm start`
