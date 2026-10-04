// One-time bootstrap. Creates adminFlags/admins with the initial admin email
// list so isAdmin() in Firestore rules resolves to true for whoever runs the
// rules deploy. Idempotent — re-running adds any missing emails.
//
//   npx tsx scripts/bootstrap-admin.ts [email-a] [email-b] ...
//
// If no emails are passed, defaults to ['amishu197@gmail.com'].
import { getDb } from './_admin';

async function main() {
  const db = getDb();
  const ref = db.doc('adminFlags/admins');
  const snap = await ref.get();

  const requested = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const defaults = ['amishu197@gmail.com'];
  const desired = requested.length > 0 ? requested : defaults;

  const existing = (snap.data()?.['emails'] as string[] | undefined) ?? [];
  const merged = Array.from(new Set([...existing, ...desired]));

  await ref.set({ emails: merged, updatedAt: new Date().toISOString() }, { merge: true });
  console.log('adminFlags/admins.emails =', merged);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
