import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { AppStateService } from './app-state.service';
import { FirebaseClientService } from './firebase-client.service';
import { InviteCodeService } from './invite-code.service';
import { ErrorReporterService } from './error-reporter.service';
import {
  arrayUnion,
  doc,
  runTransaction,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { Household, HouseholdMember, MembersByUidEntry } from '../models/app.models';

// Membership changes are atomic. Joining uses a write-only batch (no read of the
// household, which a non-member is not allowed to do under the rules): it adds
// the caller's own membersByUid entry, points their user doc at the household,
// and marks the invite code accepted — all-or-nothing. Leaving still reads
// inside a transaction because the leaver is a member and may read the doc.
@Injectable({ providedIn: 'root' })
export class HouseholdMembershipService {
  private readonly auth = inject(AuthService);
  private readonly appState = inject(AppStateService);
  private readonly firebase = inject(FirebaseClientService);
  private readonly inviteCodes = inject(InviteCodeService);
  private readonly reporter = inject(ErrorReporterService);

  async requestJoinByCode(rawCode: string): Promise<string> {
    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return 'Sign in first to join a household.';
    }

    const currentHousehold = this.appState.householdById(activeUser.householdId);
    if (currentHousehold) {
      return 'You are already part of a household. Leave your current household before joining another one.';
    }

    const code = rawCode.toUpperCase().trim();
    if (!code) {
      return 'Invite code is invalid.';
    }

    // Resolve the code via the top-level inviteCodes/{code} collection. Codes
    // minted by the app always have a matching doc there.
    const inviteDoc = await this.inviteCodes.lookupInviteCode(code);
    if (!inviteDoc) {
      return 'Invite code is invalid.';
    }
    if (this.inviteCodes.isExpired(inviteDoc)) {
      return 'Invite code has expired. Ask the household owner to regenerate a new code.';
    }
    if (inviteDoc.acceptedByUid && inviteDoc.acceptedByUid !== activeUser.id) {
      return 'Invite code has already been used.';
    }
    const householdId = inviteDoc.householdId;

    const newMember: HouseholdMember = {
      userId: activeUser.id,
      role: 'member',
      displayName: activeUser.name || 'Member',
      joinedAt: new Date().toISOString()
    };
    const newEntry: MembersByUidEntry = {
      role: 'member',
      displayName: newMember.displayName,
      joinedAt: newMember.joinedAt
    };

    try {
      // Write-only batch: a non-member is not allowed to read the household, so
      // we add our own row with a field-path merge (arrayUnion keeps the
      // members[] display mirror in sync) instead of a read-modify-write. The
      // batch is atomic across the household, user, and invite docs.
      const batch = writeBatch(this.firebase.firestore);
      const householdRef = doc(this.firebase.firestore, 'households', householdId);
      batch.update(householdRef, {
        members: arrayUnion(newMember),
        [`membersByUid.${activeUser.id}`]: newEntry,
        updatedAt: serverTimestamp()
      });
      const userRef = doc(this.firebase.firestore, 'users', activeUser.id);
      batch.set(userRef, { householdId, updatedAt: serverTimestamp() }, { merge: true });
      const inviteRef = doc(this.firebase.firestore, 'inviteCodes', code);
      batch.set(
        inviteRef,
        {
          acceptedByUid: activeUser.id,
          acceptedAt: new Date().toISOString(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      await batch.commit();
    } catch (err) {
      this.reporter.captureException(err, { source: 'requestJoinByCode', code });
      return 'Could not join. Please try again.';
    }

    await this.appState.refreshDataScope();
    return 'Joined household.';
  }

  async leaveCurrentHousehold(): Promise<string> {
    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return 'Sign in first to leave a household.';
    }

    const currentHousehold = this.appState.householdById(activeUser.householdId);
    if (!currentHousehold) {
      return 'You are not part of a household right now.';
    }

    const activeMember = currentHousehold.members.find((m) => m.userId === activeUser.id);
    const hasOtherMembers = currentHousehold.members.some((m) => m.userId !== activeUser.id);
    if (activeMember?.role === 'owner' && hasOtherMembers) {
      return 'As household owner, you need to transfer ownership before leaving.';
    }

    try {
      await runTransaction(this.firebase.firestore, async (tx) => {
        const householdRef = doc(this.firebase.firestore, 'households', currentHousehold.id);
        const householdSnap = await tx.get(householdRef);
        if (!householdSnap.exists()) {
          // Household already gone; just clear the user's pointer.
          const userRef = doc(this.firebase.firestore, 'users', activeUser.id);
          tx.set(userRef, { householdId: '', updatedAt: serverTimestamp() }, { merge: true });
          return;
        }

        const household = householdSnap.data() as Household;
        const nextMembers = (household.members ?? []).filter((m) => m.userId !== activeUser.id);
        const nextMembersByUid: Record<string, MembersByUidEntry> = { ...(household.membersByUid ?? {}) };
        delete nextMembersByUid[activeUser.id];

        tx.set(
          householdRef,
          {
            members: nextMembers,
            membersByUid: nextMembersByUid,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );

        const userRef = doc(this.firebase.firestore, 'users', activeUser.id);
        tx.set(userRef, { householdId: '', updatedAt: serverTimestamp() }, { merge: true });
      });
    } catch (err) {
      this.reporter.captureException(err, { source: 'leaveCurrentHousehold' });
      return 'Could not leave. Please try again.';
    }

    await this.appState.refreshDataScope();
    return 'You left the household.';
  }
}
