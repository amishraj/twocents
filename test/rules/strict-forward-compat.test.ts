// Guards the Phase-E cutover: the write-only self-join batch used by the app
// must keep working under firestore.rules.strict, and the read isolation must
// hold. If this breaks, the strict rules and the client join have diverged.
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, arrayUnion, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'twocents-strict-compat',
    firestore: { rules: readFileSync(join(__dirname, '..', '..', 'firestore.rules.strict'), 'utf8') }
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'households', 'h1'), {
      id: 'h1', name: 'House',
      members: [{ userId: 'owner', role: 'owner', displayName: 'Owner', joinedAt: '2026-01-01T00:00:00Z' }],
      membersByUid: { owner: { role: 'owner', displayName: 'Owner', joinedAt: '2026-01-01T00:00:00Z' } },
      currency: 'USD'
    });
    await setDoc(doc(db, 'users', 'owner'), { id: 'owner', householdId: 'h1', email: 'o@x.com' });
    await setDoc(doc(db, 'inviteCodes', 'CODE1'), { code: 'CODE1', householdId: 'h1', expiresAt: '2099-01-01T00:00:00Z', createdByUid: 'owner' });
    await setDoc(doc(db, 'users', 'joiner'), { id: 'joiner', householdId: '', email: 'j@x.com' });
  });
}

const memberEntry = { role: 'member', displayName: 'joiner', joinedAt: '2026-02-01T00:00:00Z' };

describe('strict rules forward-compat', () => {
  test('non-member cannot read household root doc', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    await assertFails(getDoc(doc(joiner.firestore(), 'households/h1')));
  });

  test('the write-only join batch (household + user + invite) succeeds', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    const db = joiner.firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, 'households', 'h1'), {
      members: arrayUnion({ userId: 'joiner', ...memberEntry }),
      'membersByUid.joiner': memberEntry
    });
    batch.set(doc(db, 'users', 'joiner'), { id: 'joiner', householdId: 'h1', email: 'j@x.com' }, { merge: true });
    batch.set(doc(db, 'inviteCodes', 'CODE1'), { acceptedByUid: 'joiner', acceptedAt: '2026-02-01T00:00:00Z' }, { merge: true });
    await assertSucceeds(batch.commit());
  });

  test('joiner cannot self-grant owner under strict rules', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    await assertFails(updateDoc(doc(joiner.firestore(), 'households', 'h1'), {
      'membersByUid.joiner': { role: 'owner', displayName: 'joiner', joinedAt: '2026-02-01T00:00:00Z' }
    }));
  });
});
