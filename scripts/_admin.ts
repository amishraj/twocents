// Shared bootstrap for admin-side migration scripts.
//
// Run from a workstation that has Firebase Admin credentials:
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
//   npx tsx scripts/<script>.ts
//
// The service account needs Cloud Datastore User on the target project.
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

export const PROJECT_ID = process.env['FIREBASE_PROJECT_ID'] ?? 'two-cents-budget-tracker';

export function getDb() {
  if (!getApps().length) {
    const credsPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    if (credsPath) {
      const json = JSON.parse(readFileSync(credsPath, 'utf-8'));
      initializeApp({ credential: cert(json), projectId: PROJECT_ID });
    } else {
      // applicationDefault() picks up gcloud creds when GOOGLE_APPLICATION_CREDENTIALS isn't set
      initializeApp({ projectId: PROJECT_ID });
    }
  }
  return getFirestore();
}
