# TwoCents Deployment & CI/CD Guide

This guide covers going live now, connecting your custom domain, and shipping updates safely via GitHub Actions.

## 1) Go Live Now (one-time)

Run these commands from the project root (`budget-tracker`):

```bash
npm install --cache ".npm-cache"
npm run build -- --configuration production
npm install -g firebase-tools
firebase login
firebase use two-cents-budget-tracker
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

Default live URLs:

- `https://two-cents-budget-tracker.web.app`
- `https://two-cents-budget-tracker.firebaseapp.com`

## 2) Connect Your Custom Domain

1. Open Firebase Console -> Hosting -> site `two-cents-budget-tracker`.
2. Click **Add custom domain**.
3. Add apex + `www` (example: `twocents.app`, `www.twocents.app`).
4. Add DNS records from Firebase at your domain registrar:
   - TXT (verification)
   - A/AAAA (apex)
   - CNAME (`www`)
5. Wait for SSL provisioning.

## 3) Enable GitHub CI/CD

Workflow already present:

- `.github/workflows/firebase-hosting.yml`

Behavior:

- PR to `main`: build validation
- Push to `main`: build + deploy to Firebase Hosting live channel

### Required GitHub Secret

Add this repository secret:

- `FIREBASE_SERVICE_ACCOUNT_TWOCENTS`

How to get it:

1. Firebase Console -> Project settings -> Service accounts.
2. Click **Generate new private key**.
3. In GitHub: Repo -> Settings -> Secrets and variables -> Actions.
4. Add new secret named `FIREBASE_SERVICE_ACCOUNT_TWOCENTS`.
5. Paste the full JSON contents.

## 4) Day-to-Day Release Flow

1. Create a branch for changes.
2. Commit and push branch.
3. Open PR to `main`.
4. Ensure CI build passes.
5. Merge PR.
6. GitHub Action auto-deploys to Firebase Hosting.

## 5) Production Checklist

Before inviting real users, verify:

- Firebase Auth providers enabled:
  - Email/Password
  - Google
- Authorized domains include:
  - `two-cents-budget-tracker.web.app`
  - `two-cents-budget-tracker.firebaseapp.com`
  - your custom domain(s)
- Firestore rules and indexes deployed.
- EmailJS template recipient uses `{{to_email}}`.
- Rotate any exposed third-party credentials (see Security below).

## 5a) Security notes (read before launch)

### Exposed client credentials

A single-page app cannot keep secrets — everything in the JS bundle is readable
by any visitor.

- **Splitwise `clientSecret`** — ✅ now server-side only. The token exchange and
  all Splitwise API reads run in the `splitwiseProxy` Cloud Function
  (`functions/index.js`); the browser only holds the public `clientId` /
  `redirectUri`. See "Splitwise setup" below. You should still **rotate** the
  current secret in the Splitwise dashboard once (it was previously bundled) and
  set the new value with `firebase functions:secrets:set SPLITWISE_CLIENT_SECRET`.
- **EmailJS `publicKey`/`serviceId`/`templateId`**. These are "publishable" but
  still tied to your account and can be abused to exhaust quota. Prefer sending
  invite emails from a backend (Cloud Function + transactional email provider),
  or at minimum keep EmailJS domain restrictions on and monitor usage.

Firebase Web API keys (`environment.firebase.apiKey`) are **not** secret — they
identify the project and are safe to ship. Access control is enforced entirely
by Firestore Security Rules.

### Security headers

`firebase.json` sets `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy`, and HSTS on all responses, plus
long-lived immutable caching for hashed assets and `no-cache` for `index.html`.

A `Content-Security-Policy` is **not** shipped by default because a wrong CSP
silently breaks Firebase Auth and Firestore. When you add one, start in
`Content-Security-Policy-Report-Only` mode and allow at least:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data:;
connect-src 'self' https://*.googleapis.com https://*.firebaseio.com
  https://firestore.googleapis.com https://identitytoolkit.googleapis.com
  https://securetoken.googleapis.com https://api.emailjs.com
  https://secure.splitwise.com https://bridge.simplefin.org;
frame-src 'self' https://two-cents-budget-tracker.firebaseapp.com;
```

Verify Google/Email sign-in and Firestore sync still work before enforcing.

### Firestore rules rollout (Phase-A → Phase-E)

`firestore.rules` is the deployed **Phase-A** compatibility ruleset;
`firestore.rules.strict` is the tightened **Phase-E** ruleset. Both are covered
by the emulator tests in `test/rules/` (`npm run test:rules`), including a
forward-compat suite that proves the app's join flow keeps working under the
strict rules. Cutover steps:

1. `npm run bootstrap:admin` — provision `adminFlags/admins`.
2. `npm run migrate:roles` — backfill `membersByUid` on every household.
3. Let the app run dual-writing for a few days.
4. `npm run test:rules` — all suites green.
5. Replace `firestore.rules` with `firestore.rules.strict` and
   `firebase deploy --only firestore:rules`.

## 5b) Splitwise setup (required for the Splitwise tab)

Splitwise's OAuth token endpoint and REST API send **no CORS headers**, so the
browser cannot call them directly — a pure client-side connection can never
work. TwoCents routes Splitwise through the `splitwiseProxy` Cloud Function
(`functions/`), reached same-origin via the Hosting rewrite `/api/splitwise/**`.

**Requires the Blaze (pay-as-you-go) plan** — Cloud Functions need billing
enabled and make outbound calls to splitwise.com. There's a generous free tier.

One-time setup:

```bash
# 1. Upgrade the Firebase project to Blaze in the console (Billing).
# 2. Install function deps
cd functions && npm install && cd ..
# 3. Set the Splitwise client secret (rotate it first in the Splitwise dashboard)
firebase functions:secrets:set SPLITWISE_CLIENT_SECRET
# 4. Deploy the function + hosting rewrite together
firebase deploy --only functions,hosting
```

Notes:
- The public `clientId` and `redirectUri` default inside `functions/index.js`;
  override with `SPLITWISE_CLIENT_ID` / `SPLITWISE_REDIRECT_URI` if they change.
- In the Splitwise developer dashboard, the registered **Callback URL** must
  exactly match `redirectUri`
  (`https://two-cents-budget-tracker.web.app/#/splitwise/callback`).
- Splitwise OAuth only completes on the deployed domain (the redirect URL is a
  production URL), so the connect flow can't be exercised on `localhost` unless
  you also register a localhost callback and run the hosting+functions emulators.
- The proxy itself is covered locally: `firebase emulators:start --only functions,hosting`
  then `curl -XPOST localhost:5055/api/splitwise/token -d '{"code":"x"}' -H 'content-type: application/json'`
  returns Splitwise's own JSON (proving the round-trip), not a CORS error.

## 6) Useful Commands

Build locally:

```bash
npm run build -- --configuration production
```

Deploy only hosting:

```bash
firebase deploy --only hosting
```

Deploy only Firestore rules/indexes:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## 6a) Local development against Firebase emulators

Develop and test without touching the production project:

```bash
npx firebase emulators:start --only auth,firestore --project two-cents-budget-tracker
```

```bash
npm start -- --configuration emulator --port 4291
```

The `emulator` configuration swaps in `src/environments/environment.emulator.ts` (`useEmulators: true`),
which points Auth at `127.0.0.1:9099` and Firestore at `127.0.0.1:8080`. Emulator data is in-memory.
See `test/emulator/README.md` for throwaway test accounts.

## 7) Troubleshooting

- **CI deploy fails on secret**: verify `FIREBASE_SERVICE_ACCOUNT_TWOCENTS` is valid JSON and belongs to project `two-cents-budget-tracker`.
- **Auth blocked on custom domain**: add your domain in Firebase Auth authorized domains.
- **Invite emails fail**: verify EmailJS template To field mapping is `{{to_email}}`.
- **Page refresh route issues**: Hosting rewrite is already configured in `firebase.json`.
