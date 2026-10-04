// Join + invite-acceptance rules, validating the write-only self-join path used
// by HouseholdMembershipService.requestJoinByCode.
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
    projectId: 'twocents-join-rules',
    firestore: { rules: readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8') }
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
      inviteCode: 'CODE1', currency: 'USD'
    });
    await setDoc(doc(db, 'users', 'owner'), { id: 'owner', householdId: 'h1', email: 'o@x.com' });
    await setDoc(doc(db, 'inviteCodes', 'CODE1'), { code: 'CODE1', householdId: 'h1', expiresAt: '2099-01-01T00:00:00Z', createdByUid: 'owner' });
    await setDoc(doc(db, 'users', 'joiner'), { id: 'joiner', householdId: '', email: 'j@x.com' });
    await setDoc(doc(db, 'users', 'attacker'), { id: 'attacker', householdId: '', email: 'a@x.com' });
  });
}

const memberEntry = (uid: string) => ({ role: 'member', displayName: uid, joinedAt: '2026-02-01T00:00:00Z' });

describe('household read isolation', () => {
  test('non-member cannot read the household root doc', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    await assertFails(getDoc(doc(joiner.firestore(), 'households/h1')));
  });

  test('member can read the household root doc', async () => {
    await seed();
    const owner = env.authenticatedContext('owner', { email: 'o@x.com' });
    await assertSucceeds(getDoc(doc(owner.firestore(), 'households/h1')));
  });
});

describe('self-join', () => {
  test('non-member can add only their own membersByUid entry', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    await assertSucceeds(updateDoc(doc(joiner.firestore(), 'households', 'h1'), {
      members: arrayUnion({ userId: 'joiner', ...memberEntry('joiner') }),
      'membersByUid.joiner': memberEntry('joiner')
    }));
  });

  test('joiner cannot grant themselves owner', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    await assertFails(updateDoc(doc(joiner.firestore(), 'households', 'h1'), {
      'membersByUid.joiner': { role: 'owner', displayName: 'joiner', joinedAt: '2026-02-01T00:00:00Z' }
    }));
  });

  test('joiner cannot add or modify another user row', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    await assertFails(updateDoc(doc(joiner.firestore(), 'households', 'h1'), {
      'membersByUid.joiner': memberEntry('joiner'),
      'membersByUid.attacker': memberEntry('attacker')
    }));
  });
});

describe('invite acceptance is single-use', () => {
  test('first accept succeeds, second by another user fails', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    await assertSucceeds(updateDoc(doc(joiner.firestore(), 'inviteCodes', 'CODE1'), {
      acceptedByUid: 'joiner', acceptedAt: '2026-02-01T00:00:00Z'
    }));
    const attacker = env.authenticatedContext('attacker', { email: 'a@x.com' });
    await assertFails(updateDoc(doc(attacker.firestore(), 'inviteCodes', 'CODE1'), {
      acceptedByUid: 'attacker', acceptedAt: '2026-02-02T00:00:00Z'
    }));
  });

  test('acceptance cannot repoint the code to another household', async () => {
    await seed();
    const joiner = env.authenticatedContext('joiner', { email: 'j@x.com' });
    await assertFails(updateDoc(doc(joiner.firestore(), 'inviteCodes', 'CODE1'), {
      acceptedByUid: 'joiner', householdId: 'someOtherHousehold'
    }));
  });
});

describe('atomic household creation', () => {
  test('owner creates household + points their user doc at it in one batch', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'creator'), { id: 'creator', householdId: '', email: 'c@x.com' });
    });
    const creator = env.authenticatedContext('creator', { email: 'c@x.com' });
    const db = creator.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'households', 'newh'), {
      id: 'newh', name: 'New House',
      members: [{ userId: 'creator', role: 'owner', displayName: 'Creator', joinedAt: '2026-02-01T00:00:00Z' }],
      membersByUid: { creator: { role: 'owner', displayName: 'Creator', joinedAt: '2026-02-01T00:00:00Z' } },
      currency: 'USD'
    });
    batch.set(doc(db, 'users', 'creator'), { householdId: 'newh' }, { merge: true });
    await assertSucceeds(batch.commit());
  });
});
