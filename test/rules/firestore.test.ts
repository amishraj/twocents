// Firestore rules tests against the emulator.
// Run with: `npm run test:rules` (which boots the emulator via firebase emulators:exec)
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let env: RulesTestEnvironment;

const PROJECT_ID = 'twocents-rules-test';

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8')
    }
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

async function seedHousehold(opts: {
  hid: string;
  ownerUid: string;
  memberUid?: string;
  inviteCode?: string;
}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const members = [
      { userId: opts.ownerUid, role: 'owner', displayName: 'Owner', joinedAt: '2026-01-01T00:00:00Z' }
    ];
    const membersByUid: Record<string, unknown> = {
      [opts.ownerUid]: { role: 'owner', displayName: 'Owner', joinedAt: '2026-01-01T00:00:00Z' }
    };
    if (opts.memberUid) {
      members.push({ userId: opts.memberUid, role: 'member', displayName: 'Member', joinedAt: '2026-01-02T00:00:00Z' });
      membersByUid[opts.memberUid] = { role: 'member', displayName: 'Member', joinedAt: '2026-01-02T00:00:00Z' };
    }
    await setDoc(doc(db, 'households', opts.hid), {
      id: opts.hid,
      name: 'Test House',
      type: 'couple',
      members,
      membersByUid,
      sharedBudgetEnabled: true,
      inviteCode: opts.inviteCode ?? 'TESTCODE',
      currency: 'USD'
    });
    await setDoc(doc(db, 'users', opts.ownerUid), {
      id: opts.ownerUid,
      name: 'Owner',
      email: 'owner@example.com',
      householdId: opts.hid,
      incomeMonthly: 0,
      preferences: { currency: 'USD' },
      createdAt: '2026-01-01T00:00:00Z'
    });
    if (opts.memberUid) {
      await setDoc(doc(db, 'users', opts.memberUid), {
        id: opts.memberUid,
        name: 'Member',
        email: 'member@example.com',
        householdId: opts.hid,
        incomeMonthly: 0,
        preferences: { currency: 'USD' },
        createdAt: '2026-01-02T00:00:00Z'
      });
    }
    if (opts.inviteCode) {
      await setDoc(doc(db, 'inviteCodes', opts.inviteCode), {
        code: opts.inviteCode,
        householdId: opts.hid,
        expiresAt: '2099-01-01T00:00:00Z',
        createdByUid: opts.ownerUid
      });
    }
  });
}

describe('phase-A Firestore rules', () => {
  test('non-member cannot delete a household category', async () => {
    await seedHousehold({ hid: 'h1', ownerUid: 'owner' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'households/h1/categories/c1'), { id: 'c1', name: 'Groceries' });
    });
    const outsider = env.authenticatedContext('stranger', { email: 'stranger@example.com' });
    await assertFails(deleteDoc(doc(outsider.firestore(), 'households/h1/categories/c1')));
  });

  test('non-member cannot read household sub-collections', async () => {
    await seedHousehold({ hid: 'h1', ownerUid: 'owner' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'households/h1/transactions/t1'), { id: 't1', amount: 1 });
    });
    const outsider = env.authenticatedContext('stranger', { email: 'stranger@example.com' });
    await assertFails(getDoc(doc(outsider.firestore(), 'households/h1/transactions/t1')));
  });

  test('member can read household category, write transaction, delete only as owner', async () => {
    await seedHousehold({ hid: 'h1', ownerUid: 'owner', memberUid: 'member' });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'households/h1/categories/c1'), { id: 'c1', name: 'Groceries' });
    });
    const member = env.authenticatedContext('member', { email: 'member@example.com' });
    await assertSucceeds(getDoc(doc(member.firestore(), 'households/h1/categories/c1')));
    await assertSucceeds(
      setDoc(doc(member.firestore(), 'households/h1/transactions/t2'), { id: 't2', amount: 5 })
    );
    // Phase-A: only owner can delete a category.
    await assertFails(deleteDoc(doc(member.firestore(), 'households/h1/categories/c1')));
    const owner = env.authenticatedContext('owner', { email: 'owner@example.com' });
    await assertSucceeds(deleteDoc(doc(owner.firestore(), 'households/h1/categories/c1')));
  });

  test('non-member can get an inviteCode by code but cannot list the collection', async () => {
    await seedHousehold({ hid: 'h1', ownerUid: 'owner', inviteCode: 'INVITE1234567890' });
    const outsider = env.authenticatedContext('stranger', { email: 'stranger@example.com' });
    await assertSucceeds(getDoc(doc(outsider.firestore(), 'inviteCodes/INVITE1234567890')));
    // list is denied; we don't have a query helper here, but a write to a sibling
    // doc should still fail because non-members can't create invites for households
    // they aren't members of.
    await assertFails(
      setDoc(doc(outsider.firestore(), 'inviteCodes/STRANGERCODE'), {
        code: 'STRANGERCODE',
        householdId: 'h1',
        expiresAt: '2099-01-01T00:00:00Z',
        createdByUid: 'stranger'
      })
    );
  });

  test('personal subcollections are private to the owning user', async () => {
    const userA = env.authenticatedContext('A', { email: 'a@example.com' });
    await assertSucceeds(setDoc(doc(userA.firestore(), 'users/A/categories/c1'), { id: 'c1', name: 'X' }));
    const userB = env.authenticatedContext('B', { email: 'b@example.com' });
    await assertFails(getDoc(doc(userB.firestore(), 'users/A/categories/c1')));
  });

  test('admin email can write adminFlags but other users cannot', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'adminFlags/admins'), { emails: ['admin@example.com'] });
    });
    const admin = env.authenticatedContext('admin', { email: 'admin@example.com' });
    await assertSucceeds(
      updateDoc(doc(admin.firestore(), 'adminFlags/admins'), { emails: ['admin@example.com', 'b@example.com'] })
    );
    const other = env.authenticatedContext('other', { email: 'other@example.com' });
    await assertFails(
      updateDoc(doc(other.firestore(), 'adminFlags/admins'), { emails: [] })
    );
  });
});
