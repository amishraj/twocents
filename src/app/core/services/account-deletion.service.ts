import { Injectable, inject } from '@angular/core';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signOut
} from 'firebase/auth';
import {
  WriteBatch,
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { FirebaseClientService } from './firebase-client.service';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';
import { ErrorReporterService } from './error-reporter.service';
import { Household, User } from '../models/app.models';

// Resumable account deletion. Designed so a crash mid-wipe can be picked up on
// next login by calling resumeIfPending(). All writes are idempotent — every
// soft-delete uses {merge: true} and the cursor lives on users/{uid}.
//
// Order of operations:
//   1. Preflight checks (sole-owner-with-others must transfer first)
//   2. Caller-supplied reauth (component owns the UI; passes a method tag)
//   3. Set deletionStatus = 'in_progress' (recoverable from this point)
//   4. Remove self from household (runTransaction)
//   5. Soft-delete personal subcollections in 450-write batches
//   6. Redact root user doc (PII gone, deleted=true, status='complete')
//   7. deleteUser(authUser)
//   8. Sign out, clear local state
//
// If step 7 throws, the user can log back in; resumeIfPending observes
// status='complete' is NOT set and offers to retry from step 7. If step 4–6
// were partially done, the cursor identifies the next collection to process.
@Injectable({ providedIn: 'root' })
export class AccountDeletionService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  private readonly reporter = inject(ErrorReporterService);

  private static readonly PERSONAL_COLLECTIONS = [
    'transactions',
    'categories',
    'budgets',
    'savings',
    'investments',
    'recurringTemplates',
    'additionalIncome',
    'bankConnections',
    'bankAccounts',
    'bankIssues'
  ];

  isPending(user: User | undefined): boolean {
    return Boolean(user?.accountDeletion && user.accountDeletion.status !== 'complete');
  }

  canLeaveHousehold(): { ok: true } | { ok: false; reason: string } {
    const user = this.auth.getActiveUser();
    if (!user) return { ok: false, reason: 'Sign in first.' };
    const household = this.appState.householdById(user.householdId);
    if (!household) return { ok: true };
    const me = household.members.find((m) => m.userId === user.id);
    const others = household.members.filter((m) => m.userId !== user.id);
    if (me?.role === 'owner' && others.length > 0) {
      return { ok: false, reason: 'Transfer household ownership before deleting your account.' };
    }
    return { ok: true };
  }

  async reauthenticate(method: 'password', password: string): Promise<void>;
  async reauthenticate(method: 'google'): Promise<void>;
  async reauthenticate(method: 'password' | 'google', password?: string): Promise<void> {
    const authUser = this.firebase.auth.currentUser;
    if (!authUser || !authUser.email) {
      throw new Error('No active user.');
    }
    if (method === 'password') {
      if (!password) throw new Error('Password required.');
      const credential = EmailAuthProvider.credential(authUser.email, password);
      await reauthenticateWithCredential(authUser, credential);
    } else {
      await reauthenticateWithPopup(authUser, new GoogleAuthProvider());
    }
  }

  async startOrResume(): Promise<void> {
    const user = this.auth.getActiveUser();
    if (!user) {
      throw new Error('No active user.');
    }

    const guard = this.canLeaveHousehold();
    if (!guard.ok) {
      throw new Error(guard.reason);
    }

    await this.markStatus(user.id, 'in_progress', user.accountDeletion?.cursorCollection);

    await this.removeSelfFromHousehold(user.id);

    for (const name of AccountDeletionService.PERSONAL_COLLECTIONS) {
      await this.softDeleteCollection(user.id, name);
      await this.markStatus(user.id, 'in_progress', name);
    }

    await this.redactRootUserDoc(user.id);
    await this.markStatus(user.id, 'complete');

    const authUser = this.firebase.auth.currentUser;
    if (authUser) {
      try {
        await deleteUser(authUser);
      } catch (err) {
        this.reporter.captureException(err, { source: 'deleteUser' });
        throw err;
      }
    }

    await signOut(this.firebase.auth);
  }

  private async removeSelfFromHousehold(uid: string): Promise<void> {
    const user = this.auth.getActiveUser();
    const householdId = user?.householdId;
    if (!householdId) {
      return;
    }
    try {
      await runTransaction(this.firebase.firestore, async (tx) => {
        const ref = doc(this.firebase.firestore, 'households', householdId);
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          return;
        }
        const household = snap.data() as Household;
        const others = (household.members ?? []).filter((m) => m.userId !== uid);
        const byUid = { ...(household.membersByUid ?? {}) };
        delete byUid[uid];

        if (others.length === 0) {
          // Sole owner: soft-dissolve household (we never hard-delete; rules deny it).
          tx.set(
            ref,
            {
              members: [],
              membersByUid: {},
              deleted: true,
              deletedAt: new Date().toISOString(),
              updatedAt: serverTimestamp()
            },
            { merge: true }
          );
        } else {
          tx.set(
            ref,
            { members: others, membersByUid: byUid, updatedAt: serverTimestamp() },
            { merge: true }
          );
        }
      });
    } catch (err) {
      this.reporter.captureException(err, { source: 'removeSelfFromHousehold' });
      throw err;
    }
  }

  private async softDeleteCollection(uid: string, name: string): Promise<void> {
    const ref = collection(this.firebase.firestore, `users/${uid}/${name}`);
    const snap = await getDocs(ref);
    if (snap.empty) {
      return;
    }
    const now = new Date().toISOString();
    let batch: WriteBatch = writeBatch(this.firebase.firestore);
    let count = 0;
    for (const docSnap of snap.docs) {
      batch.set(
        docSnap.ref,
        { deleted: true, deletedAt: now, updatedAt: serverTimestamp() },
        { merge: true }
      );
      count += 1;
      if (count >= 450) {
        await batch.commit();
        batch = writeBatch(this.firebase.firestore);
        count = 0;
      }
    }
    if (count > 0) {
      await batch.commit();
    }
  }

  private async redactRootUserDoc(uid: string): Promise<void> {
    const ref = doc(this.firebase.firestore, 'users', uid);
    await setDoc(
      ref,
      {
        name: '[deleted]',
        email: `${uid}@deleted.invalid`,
        incomeMonthly: 0,
        householdId: '',
        deleted: true,
        deletedAt: new Date().toISOString(),
        preferences: {},
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  private async markStatus(
    uid: string,
    status: 'pending' | 'in_progress' | 'complete',
    cursorCollection?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const ref = doc(this.firebase.firestore, 'users', uid);
    await setDoc(
      ref,
      {
        accountDeletion: {
          status,
          startedAt: this.auth.getActiveUser()?.accountDeletion?.startedAt ?? now,
          updatedAt: now,
          ...(cursorCollection ? { cursorCollection } : {})
        },
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }
}
