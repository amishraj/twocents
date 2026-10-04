import { Injectable, inject } from '@angular/core';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { FirebaseClientService } from './firebase-client.service';
import { InviteCodeDoc } from '../models/app.models';

// Top-level inviteCodes/{code} collection. Lets non-members resolve an invite
// to a householdId without granting them read access to the household root doc.
// Rules: allow get (single-doc by known code) but deny list (no enumeration).
@Injectable({ providedIn: 'root' })
export class InviteCodeService {
  private readonly firebase = inject(FirebaseClientService);

  async writeInviteCode(params: {
    code: string;
    householdId: string;
    expiresAt: string;
    createdByUid: string;
  }): Promise<void> {
    const ref = doc(this.firebase.firestore, 'inviteCodes', params.code);
    const payload: Omit<InviteCodeDoc, 'acceptedByUid' | 'acceptedAt'> = {
      code: params.code,
      householdId: params.householdId,
      expiresAt: params.expiresAt,
      createdByUid: params.createdByUid
    };
    await setDoc(ref, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
  }

  async lookupInviteCode(code: string): Promise<InviteCodeDoc | null> {
    const ref = doc(this.firebase.firestore, 'inviteCodes', code);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return null;
    }
    return snap.data() as InviteCodeDoc;
  }

  isExpired(invite: InviteCodeDoc): boolean {
    if (!invite.expiresAt) {
      return false;
    }
    const t = new Date(invite.expiresAt).getTime();
    return Number.isFinite(t) && t < Date.now();
  }
}
