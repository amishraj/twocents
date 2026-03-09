import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { AppStateService } from './app-state.service';
import { createId, createInviteCode } from '../utils/id';

@Injectable({ providedIn: 'root' })
export class HouseholdMembershipService {
  private readonly auth = inject(AuthService);
  private readonly appState = inject(AppStateService);

  requestJoinByCode(rawCode: string): string {
    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return 'Sign in first to join a household.';
    }

    const currentHousehold = this.appState.householdById(activeUser.householdId);
    if (!currentHousehold) {
      return 'Your current household could not be found.';
    }

    const code = rawCode.toUpperCase().trim();
    const targetHousehold = this.appState.households().find((item) => item.inviteCode === code);

    if (!targetHousehold) {
      return 'Invite code is invalid.';
    }

    if (targetHousehold.id === currentHousehold.id) {
      return 'You are already in this household.';
    }

    this.joinHousehold(activeUser.id, currentHousehold.id, targetHousehold.id, activeUser.name);
    return `Joined ${targetHousehold.name}.`;
  }

  leaveCurrentHousehold(): string {
    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return 'Sign in first to leave a household.';
    }

    const currentHousehold = this.appState.householdById(activeUser.householdId);
    if (!currentHousehold) {
      return 'Current household could not be found.';
    }

    if (currentHousehold.members.length <= 1) {
      return 'You are already in your own household.';
    }

    const now = new Date().toISOString();
    const newHouseholdId = createId();
    const newHousehold = {
      id: newHouseholdId,
      name: `${activeUser.name} Household`,
      type: 'solo' as const,
      members: [
        {
          userId: activeUser.id,
          role: 'owner' as const,
          displayName: activeUser.name,
          joinedAt: now
        }
      ],
      sharedBudgetEnabled: true,
      inviteCode: createInviteCode(),
      currency: activeUser.preferences.currency || 'USD'
    };

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
      householdId: newHouseholdId
    });

    this.appState.updateHouseholds([newHousehold, ...households]);
    return 'You left the household and moved to your own household.';
  }

  private joinHousehold(userId: string, fromHouseholdId: string, targetHouseholdId: string, name: string): void {
    const households = this.appState.households().map((household) => {
      if (household.id === fromHouseholdId) {
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

    const activeUser = this.auth.getActiveUser();
    if (activeUser) {
      this.auth.updateUser({
        ...activeUser,
        householdId: targetHouseholdId
      });
    }

    this.appState.updateHouseholds(households);
  }
}
