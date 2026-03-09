# TwoCents

TwoCents is an Angular household budget tracker with Firebase Auth + Firestore persistence, recurring transaction generation, and Firebase Hosting CI/CD.

## Features

- Google + email/password auth
- One-household-per-user model
- Roles: owner, manager, member (product model)
- Budgets, categories, transactions, savings, investments, profile, household views
- Monthly recurring transaction templates with automatic catch-up instance generation
- Household currency (USD default, selectable during onboarding)

## Local run

```bash
npm install --cache ".npm-cache"
npm start
```

## Firebase setup checklist

1. Enable Auth providers:
   - Google
   - Email/Password
2. Keep authorized domains:
   - `localhost`
   - `two-cents-budget-tracker.firebaseapp.com`
   - `two-cents-budget-tracker.web.app`
3. Create Firestore (Native mode)

## Deploy with Firebase Hosting

```bash
npm run build -- --configuration production
firebase deploy --only hosting
```

## GitHub Actions CI/CD

Workflow file: `.github/workflows/firebase-hosting.yml`

Required GitHub secret:

- `FIREBASE_SERVICE_ACCOUNT_TWOCENTS` (service account JSON)

## Notes

- Recurring generation is client-side (Spark/free-friendly).
- Due dates are monthly and clamp to the last day of short months for day 29/30/31 rules.
