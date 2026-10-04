// Backfills households/{hid}.membersByUid from the legacy members[] array.
// Idempotent — re-running won't drop any existing role.
//
//   npx tsx scripts/migrate-member-roles.ts
import { getDb } from './_admin';

interface Member {
  userId: string;
  role: 'owner' | 'manager' | 'member';
  displayName: string;
  joinedAt: string;
}

async function main() {
  const db = getDb();
  const snap = await db.collection('households').get();
  let touched = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const members = (data['members'] as Member[] | undefined) ?? [];
    const existing = (data['membersByUid'] as Record<string, Omit<Member, 'userId'>> | undefined) ?? {};

    const next: Record<string, Omit<Member, 'userId'>> = { ...existing };
    let dirty = false;
    for (const m of members) {
      if (!m?.userId) continue;
      if (!next[m.userId]) {
        next[m.userId] = { role: m.role, displayName: m.displayName, joinedAt: m.joinedAt };
        dirty = true;
      }
    }
    if (dirty) {
      await docSnap.ref.set({ membersByUid: next, updatedAt: new Date().toISOString() }, { merge: true });
      touched += 1;
      console.log(`  ${docSnap.id} → ${Object.keys(next).length} members`);
    }
  }
  console.log(`Done. Updated ${touched} households out of ${snap.size}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
