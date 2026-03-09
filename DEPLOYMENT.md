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

## 7) Troubleshooting

- **CI deploy fails on secret**: verify `FIREBASE_SERVICE_ACCOUNT_TWOCENTS` is valid JSON and belongs to project `two-cents-budget-tracker`.
- **Auth blocked on custom domain**: add your domain in Firebase Auth authorized domains.
- **Invite emails fail**: verify EmailJS template To field mapping is `{{to_email}}`.
- **Page refresh route issues**: Hosting rewrite is already configured in `firebase.json`.
