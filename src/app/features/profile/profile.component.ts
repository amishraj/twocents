import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AppStateService } from '../../core/services/app-state.service';
import { HouseholdMembershipService } from '../../core/services/household-membership.service';
import { InviteEmailService } from '../../core/services/invite-email.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';
import { createId, createInviteCode } from '../../core/utils/id';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly membership = inject(HouseholdMembershipService);
  private readonly inviteEmailService = inject(InviteEmailService);
  private readonly inviteFlow = inject(InviteFlowService);
  public appState = inject(AppStateService);

  householdMessage = '';

  user = computed(() => this.auth.getActiveUser());
  household = computed(() => {
    const activeUser = this.user();
    return activeUser ? this.appState.householdById(activeUser.householdId) : undefined;
  });

  canShowJoinByCode = computed(() => {
    const household = this.household();
    if (!household) {
      return false;
    }

    return household.members.length <= 1;
  });

  invitesForHousehold = computed(() => {
    const household = this.household();
    if (!household) {
      return [];
    }

    return this.appState.invites().filter((invite) => invite.householdId === household.id);
  });

  requestsForCurrentHousehold = computed(() => {
    const household = this.household();
    if (!household) {
      return [];
    }

    return this.appState
      .householdChangeRequests()
      .filter((request) => request.fromHouseholdId === household.id || request.targetHouseholdId === household.id);
  });

  profileForm = this.fb.group({
    name: ['', Validators.required],
    incomeMonthly: [0, [Validators.required, Validators.min(0)]]
  });

  inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });

  codeJoinForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6)]]
  });

  constructor() {
    const activeUser = this.user();
    if (activeUser) {
      this.profileForm.patchValue({
        name: activeUser.name,
        incomeMonthly: activeUser.incomeMonthly
      });
    }

    this.route.queryParamMap.subscribe((params) => {
      const inviteCode = (params.get('inviteCode') ?? '').toUpperCase().trim();
      if (!inviteCode) {
        return;
      }

      this.inviteFlow.setPendingInviteCode(inviteCode);
      this.codeJoinForm.patchValue({ code: inviteCode });
      const autoAccept = params.get('acceptInvite') === '1';
      if (autoAccept) {
        queueMicrotask(() => this.requestJoinByCode());
      } else {
        this.householdMessage = 'Invite code loaded. Tap Join household to continue.';
      }
    });
  }

  saveProfile(): void {
    const activeUser = this.user();
    if (!activeUser || this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.auth.updateUser({
      ...activeUser,
      name: this.profileForm.value.name ?? activeUser.name,
      incomeMonthly: Number(this.profileForm.value.incomeMonthly ?? activeUser.incomeMonthly)
    });
  }

  async sendInvite(): Promise<void> {
    if (this.inviteForm.invalid || !this.household()) {
      this.inviteForm.markAllAsTouched();
      return;
    }

    const inviteEmail = (this.inviteForm.value.email ?? '').trim().toLowerCase();
    const household = this.household();
    if (!household || !inviteEmail) {
      return;
    }

    const duplicateInvite = this.appState
      .invites()
      .some((invite) => invite.householdId === household.id && invite.status === 'pending' && invite.email === inviteEmail);
    if (duplicateInvite) {
      this.householdMessage = `An invite for ${inviteEmail} is already pending.`;
      return;
    }

    const existingMember = this.appState
      .users()
      .find((appUser) => appUser.email.trim().toLowerCase() === inviteEmail && appUser.householdId === household.id);
    if (existingMember) {
      this.householdMessage = `${inviteEmail} is already in this household.`;
      return;
    }

    try {
      await this.inviteEmailService.sendHouseholdInvite({
        toEmail: inviteEmail,
        householdName: household.name,
        inviteCode: household.inviteCode,
        inviteLink: this.buildInviteLink(household.inviteCode),
        inviterName: this.user()?.name ?? 'A TwoCents user'
      });

      this.appState.addInvite({
        id: createId(),
        householdId: household.id,
        email: inviteEmail,
        status: 'pending',
        sentAt: new Date().toISOString()
      });

      this.householdMessage = `Invite sent to ${inviteEmail}.`;
    } catch (error: unknown) {
      this.householdMessage =
        error instanceof Error
          ? error.message
          : 'Failed to send invite email. Check EmailJS template fields and try again.';
      return;
    }

    this.inviteForm.reset({ email: '' });
  }

  cancelInvite(inviteId: string): void {
    const invite = this.appState.invites().find((item) => item.id === inviteId);
    if (!invite) {
      return;
    }

    this.appState.removeInvite(inviteId);
    this.householdMessage = `Invite canceled for ${invite.email}.`;
  }

  copyInviteLink(): void {
    const household = this.household();
    if (!household || !navigator?.clipboard) {
      return;
    }

    void navigator.clipboard.writeText(this.buildInviteLink(household.inviteCode));
    this.householdMessage = 'Invite link copied.';
  }

  regenerateInviteCode(): void {
    const household = this.household();
    if (!household) {
      return;
    }

    const next = {
      ...household,
      inviteCode: createInviteCode()
    };

    this.appState.updateHouseholds(
      this.appState.households().map((item) => (item.id === next.id ? next : item))
    );
    this.householdMessage = `New invite code generated: ${next.inviteCode}`;
  }

  requestJoinByCode(): void {
    this.householdMessage = '';
    if (this.codeJoinForm.invalid) {
      this.codeJoinForm.markAllAsTouched();
      return;
    }

    const code = (this.codeJoinForm.value.code ?? '').toUpperCase().trim();
    this.householdMessage = this.membership.requestJoinByCode(code);
    if (
      this.householdMessage.startsWith('Joined ') ||
      this.householdMessage === 'You are already in this household.'
    ) {
      this.inviteFlow.clearPendingInviteCode();
    }

    this.codeJoinForm.reset({ code: '' });
  }

  approveRequest(requestId: string): void {
    const activeUser = this.user();
    if (!activeUser) {
      return;
    }

    const requests = this.appState.householdChangeRequests();
    const request = requests.find((item) => item.id === requestId);
    if (!request || request.userId === activeUser.id) {
      return;
    }

    const approverHousehold = this.appState.householdById(request.fromHouseholdId);
    const approverMember = approverHousehold?.members.find((member) => member.userId === activeUser.id);
    if (!approverMember || approverMember.role !== 'owner') {
      return;
    }

    const next = requests.map((item) =>
      item.id === requestId
        ? {
            ...item,
            status: 'approved' as const,
            approvedByUserId: activeUser.id,
            decidedAt: new Date().toISOString()
          }
        : item
    );

    this.appState.updateHouseholdChangeRequests(next);
    this.householdMessage = 'Request approved.';
  }

  private buildInviteLink(inviteCode: string): string {
    return `${window.location.origin}/#/auth?inviteCode=${encodeURIComponent(inviteCode)}`;
  }
}
