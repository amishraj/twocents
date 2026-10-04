// Backfills transactions.localDate from the legacy ISO `date` field.
// Iterates BOTH:
//   - households/{hid}/transactions
//   - users/{uid}/transactions
// Idempotent — only touches docs missing localDate.
//
//   npx tsx scripts/migrate-local-date.ts
//
// Run AFTER deploying the dual-writing app (phase-B) so new writes already
// carry localDate and the backfill only catches pre-existing rows.
import { getDb } from './_admin';

function coerceLegacyToLocalDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function backfillCollection(db: FirebaseFirestore.Firestore, path: string): Promise<number> {
  const snap = await db.collection(path).get();
  let touched = 0;
  let batch = db.batch();
  let count = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (typeof data['localDate'] === 'string' && data['localDate'].length > 0) {
      continue;
    }
    const localDate = coerceLegacyToLocalDate(data['date']);
    if (!localDate) {
      continue;
    }
    batch.set(docSnap.ref, { localDate, updatedAt: new Date().toISOString() }, { merge: true });
    touched += 1;
    count += 1;
    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
  }
  return touched;
}

async function main() {
  const db = getDb();

  let total = 0;
  const households = await db.collection('households').get();
  for (const docSnap of households.docs) {
    const n = await backfillCollection(db, `households/${docSnap.id}/transactions`);
    if (n > 0) console.log(`  households/${docSnap.id}/transactions → ${n}`);
    total += n;
  }

  const users = await db.collection('users').get();
  for (const docSnap of users.docs) {
    const n = await backfillCollection(db, `users/${docSnap.id}/transactions`);
    if (n > 0) console.log(`  users/${docSnap.id}/transactions → ${n}`);
    total += n;
  }

  console.log(`Done. Updated ${total} transactions.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
