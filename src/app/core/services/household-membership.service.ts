import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { AppStateService } from './app-state.service';
import { FirebaseClientService } from './firebase-client.service';
import { Household } from '../models/app.models';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class HouseholdMembershipService {
  private readonly auth = inject(AuthService);
  private readonly appState = inject(AppStateService);
  private readonly firebase = inject(FirebaseClientService);

  async requestJoinByCode(rawCode: string): Promise<string> {
    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return Promise.resolve('Sign in first to join a household.');
    }

    const currentHousehold = this.appState.householdById(activeUser.householdId);
    if (currentHousehold) {
      return 'You are already part of a household. Leave your current household before joining another one.';
    }

    const code = rawCode.toUpperCase().trim();
    if (!code) {
      return 'Invite code is invalid.';
    }

    const targetHousehold = await this.findHouseholdByInviteCode(code);

    if (!targetHousehold) {
      return 'Invite code is invalid.';
    }

    if (this.isInviteCodeExpired(targetHousehold)) {
      return 'Invite code has expired. Ask the household owner to regenerate a new code.';
    }

    if (targetHousehold.members.some((member) => member.userId === activeUser.id)) {
      this.auth.updateUser({
        ...activeUser,
        householdId: targetHousehold.id
      });
      return `Joined ${targetHousehold.name}.`;
    }

    this.joinHousehold(activeUser.id, undefined, targetHousehold, activeUser.name);
    return `Joined ${targetHousehold.name}.`;
  }

  leaveCurrentHousehold(): string {
    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return 'Sign in first to leave a household.';
    }

    const currentHousehold = this.appState.householdById(activeUser.householdId);
    if (!currentHousehold) {
      return 'You are not part of a household right now.';
    }

    const households = this.appState.households()
      .map((household) => {
        if (household.id !== currentHousehold.id) {
          return household;
        }

        return {
          ...household,
          members: household.members.filter((member) => member.userId !== activeUser.id)
        };
      })
      .filter((household) => household.members.length > 0);

    this.auth.updateUser({
      ...activeUser,
      householdId: ''
    });

    this.appState.updateHouseholds(households);
    return 'You left the household.';
  }

  private async findHouseholdByInviteCode(code: string): Promise<Household | null> {
    const local = this.appState.households().find((item) => item.inviteCode === code);
    if (local) {
      return local;
    }

    const householdsRef = collection(this.firebase.firestore, 'households');
    const q = query(householdsRef, where('inviteCode', '==', code), limit(1));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return null;
    }

    const docSnap = snapshot.docs[0];
    return { id: docSnap.id, ...(docSnap.data() as Omit<Household, 'id'>) };
  }

  private isInviteCodeExpired(household: Household): boolean {
    if (!household.inviteCodeExpiresAt) {
      return false;
    }

    const expiresAt = new Date(household.inviteCodeExpiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt < Date.now();
  }

  private joinHousehold(userId: string, fromHouseholdId: string | undefined, targetHousehold: Household, name: string): void {
    const targetHouseholdId = targetHousehold.id;
    const households = this.appState.households().map((household) => {
      if (fromHouseholdId && household.id === fromHouseholdId) {
        return {
          ...household,
          members: household.members.filter((member) => member.userId !== userId)
        };
      }

      if (household.id === targetHouseholdId) {
        const exists = household.members.some((member) => member.userId === userId);
        if (exists) {
          return household;
        }

        return {
          ...household,
          members: [
            ...household.members,
            {
              userId,
              role: 'member' as const,
              displayName: name || 'Member',
              joinedAt: new Date().toISOString()
            }
          ]
        };
      }

      return household;
    });

    const hasTargetHouseholdLocally = households.some((household) => household.id === targetHouseholdId);
    const nextHouseholds = hasTargetHouseholdLocally
      ? households
      : [
          {
            ...targetHousehold,
            members: [
              ...targetHousehold.members,
              {
                userId,
                role: 'member' as const,
                displayName: name || 'Member',
                joinedAt: new Date().toISOString()
              }
            ]
          },
          ...households
        ];

    const activeUser = this.auth.getActiveUser();
    if (activeUser) {
      this.auth.updateUser({
        ...activeUser,
        householdId: targetHouseholdId
      });
    }

    this.appState.updateHouseholds(nextHouseholds);
  }
}
