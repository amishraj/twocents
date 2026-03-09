import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { AppStateService } from './app-state.service';
import { createId } from '../utils/id';

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

    const pendingOrApproved = this.appState
      .householdChangeRequests()
      .find(
        (request) =>
          request.userId === activeUser.id &&
          request.fromHouseholdId === currentHousehold.id &&
          request.targetHouseholdId === targetHousehold.id &&
          (request.status === 'pending' || request.status === 'approved')
      );

    const otherMembersExist = currentHousehold.members.some((member) => member.userId !== activeUser.id);

    if (pendingOrApproved?.status === 'pending') {
      return 'Leave request is pending. Another household member must approve it first.';
    }

    if (!pendingOrApproved && otherMembersExist) {
      this.appState.addHouseholdChangeRequest({
        id: createId(),
        userId: activeUser.id,
        fromHouseholdId: currentHousehold.id,
        targetHouseholdId: targetHousehold.id,
        status: 'pending',
        requestedAt: new Date().toISOString()
      });
      return 'Leave request created. Ask another member to approve, then join again.';
    }

    this.joinHousehold(activeUser.id, currentHousehold.id, targetHousehold.id, activeUser.name);
    return `Joined ${targetHousehold.name}.`;
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
