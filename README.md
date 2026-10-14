# SocialPay SS — working Firebase website

This project recreates the main visible flows from the supplied SocialPay SS screen recording using separate HTML pages, a shared responsive design system, Firebase Authentication, Firestore, and trusted Firebase Cloud Functions.

## What's included

- Public landing page, features, how-it-works, payout history, and FAQ.
- Separate register, sign-in, payment, dashboard, tasks, proof submission, submissions, wallet/ledger, withdrawals, referrals, profile, friends, chat, status, sponsored tasks, ads, and Meta AI pages.
- Standard and Premium package options shown in the recording: ₦15,000 / ₦20,000 welcome bonus and ₦30,000 / ₦50,000 welcome bonus. A bonus is recorded only after an admin verifies the related bank transfer.
- Manual bank transfer requests with unique payment references and the exact amount due, including the configured transfer fee. A member can report the transfer; reporting does **not** mark it paid.
- Admin review queue for payments, withdrawal requests, and task proof. Approving a withdrawal publishes a pseudonymous record to the public payout page. Rejected withdrawals are refunded to the member's wallet by the backend.
- Wallet balance and task rewards are server-managed. A client-side user cannot simply change their own wallet amount or mark a transfer paid.
- Referral tracking, friend requests, community chat, and a simple status feed.
- Firestore security rules and query indexes.

## Important before launch

The uploaded recording displays a bank account and sample people/payout rows. Those values are **not copied** into this project. Configure a bank account that you control, and only publish payout records for withdrawals you have actually paid. Review your membership, bonus, and refund terms before accepting money from users.

The recording's spoken narration could not be reliably transcribed in this environment. This build follows the screens that were visible in the recording; it may not capture requirements that were only spoken and never shown onscreen.

## 1. Create a Firebase project

1. Create a project at the Firebase Console.
2. Add a **Web app** and copy its Firebase client configuration.
3. In **Authentication → Sign-in method**, enable **Email/Password**.
4. Create a Firestore database.
5. Make sure the account uses its real identity details; do not ask users for social media passwords.

## 2. Add the Firebase web settings

Edit `src/firebase.js` and replace these placeholders with the values from your Firebase Web app config:

- `YOUR_FIREBASE_API_KEY`
- `YOUR_PROJECT_ID`
- `YOUR_MESSAGING_SENDER_ID`
- `YOUR_FIREBASE_APP_ID`

Use the exact `authDomain`, `storageBucket`, and other values Firebase provides. The browser config is expected to be public; security is enforced by Firestore Rules and backend checks. **Never add a service-account JSON, Paystack secret, or other private key to the frontend or GitHub.**

## 3. Configure your transfer destination

From this project directory, install and sign into the Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

Deploying the Functions may require your Firebase project to use a billing-enabled plan. The first deployment prompts for the required transfer destination parameters. Supply your actual details:

- `PAYMENT_BANK_NAME`
- `PAYMENT_ACCOUNT_NAME`
- `PAYMENT_ACCOUNT_NUMBER` (10–12 digits)
- `PAYMENT_TRANSFER_FEE` (defaults to `400`; set `0` if you do not charge a transfer fee)

Do not leave the `SET_*` placeholders in a live payment setup. Do not use the reference site's bank details unless that account is actually yours and authorized for these payments.

## 4. Deploy the backend and database rules

From the project root:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules,firestore:indexes
```

The Functions are deployed in `us-central1`. If Firebase prompts for payment settings, enter your real bank destination. Firestore indexes are included in `firestore.indexes.json`.

## 5. Give your account administrator access

1. Create a user through the site's registration page and verify which user ID belongs to you in Firebase Authentication.
2. In Firestore Console, manually create a document at `admins/PASTE_YOUR_AUTH_UID` (replace the path suffix with your actual UID).
3. Add a boolean field `enabled` with value `true`.
4. Open `admin.html` while signed in to that account.

Only trusted admins should have this document. Never make the `admins` collection writable by the public client.

## 6. Publish the frontend to GitHub Pages

1. Push the project files to the root of a GitHub repository.
2. In GitHub, open **Settings → Pages** and select the branch/folder containing the HTML files.
3. Wait for GitHub Pages to publish, then open the provided HTTPS URL.
4. Add that GitHub Pages domain to Firebase Authentication's **Authorized domains** list if it is not already listed.
5. Verify register/sign-in, create a payment request, report a test transfer, and review it from `admin.html` using a test account before going live.

GitHub Pages hosts only the frontend. Firebase Cloud Functions and Firestore run separately in your Firebase project; the Functions deployment above is required for secure payments, wallet changes, moderation, and withdrawals.

## Page map

| File | Purpose |
|---|---|
| `index.html` | Public landing page |
| `register.html`, `login.html`, `logout.html` | Authentication and sign-out |
| `dashboard.html` | Member overview and quick actions |
| `payment.html` | Activation/top-up bank transfer request |
| `tasks.html`, `submit-task.html`, `submissions.html` | Task browsing and proof review flow |
| `wallet.html`, `payments.html`, `payment.html`, `withdraw.html`, `payouts.html` | Wallet, payment history, bank transfer requests, withdrawals, verified public payouts |
| `friends.html`, `chat.html`, `status.html` | Community features |
| `sponsored.html`, `ads.html`, `meta-ai.html` | Other quick actions visible in the reference |
| `referrals.html`, `profile.html`, `faq.html`, `terms.html`, `privacy.html` | Referrals, profile, help, terms, privacy |
| `admin.html` | Payment, withdrawal, task moderation (admin only) |

## Test checklist

- Register a test user and verify the profile appears in Firestore.
- Try a duplicate username and make sure it is rejected.
- Create a payment request, verify the displayed account and total, then report it.
- Check the admin queue; approve only after verifying the transfer externally.
- Confirm a payment bonus is applied once, not repeatedly.
- Create a task as admin, submit proof as a member, and approve it; confirm the wallet credit appears once in the ledger.
- Request a withdrawal; mark it paid only after the real bank transfer. Reject a test request and confirm the amount is refunded.
- Open the payout page in a signed-out browser and confirm it shows paid records only.
- Test layout and links on mobile and desktop.

## Limitations to resolve before production

- Admin task management is basic. Publish ads directly from Firestore Console if you need campaign cards; only admins should have write access.
- Proof is submitted as an HTTPS URL; file upload is intentionally disabled until you configure a private, size-limited Storage workflow.
- Password reset link requires the Firebase Auth email template and authorized domain to be configured. The page will guide the user to use their registered email.
- Add your real customer support email, privacy policy, terms, company details, and applicable legal/compliance review before accepting public registrations.
