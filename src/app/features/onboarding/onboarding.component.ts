import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AppStateService } from '../../core/services/app-state.service';
import { HouseholdType } from '../../core/models/app.models';
import { HouseholdMembershipService } from '../../core/services/household-membership.service';
import { InviteEmailService } from '../../core/services/invite-email.service';
import { createId, createInviteCode, createInviteExpiry } from '../../core/utils/id';

type OnboardingStep = 'choice' | 'create' | 'join' | 'invite';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss'
})
export class OnboardingComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly appState = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly membership = inject(HouseholdMembershipService);
  private readonly inviteEmailService = inject(InviteEmailService);

  step = signal<OnboardingStep>('choice');
  message = '';

  activeUser = computed(() => this.auth.getActiveUser());
  activeHousehold = computed(() => {
    const user = this.activeUser();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });

  createForm = this.fb.group({
    householdName: ['', Validators.required],
    householdType: ['couple', Validators.required],
    currency: ['USD', Validators.required],
    incomeMonthly: [0, [Validators.required, Validators.min(0)]]
  });

  joinForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6)]],
    incomeMonthly: [0, [Validators.required, Validators.min(0)]]
  });

  inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });

  chooseCreate(): void {
    this.message = '';
    this.step.set('create');
  }

  chooseJoin(): void {
    this.message = '';
    this.step.set('join');
  }

  backToChoice(): void {
    this.message = '';
    this.step.set('choice');
  }

  skipForNow(): void {
    const activeUser = this.activeUser();
    if (!activeUser) {
      return;
    }

    this.auth.updateUser({
      ...activeUser,
      preferences: {
        ...activeUser.preferences,
        onboarded: true
      }
    });
    void this.router.navigate(['/dashboard']);
  }

  createHousehold(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    const activeUser = this.activeUser();
    if (!activeUser) {
      return;
    }

    const value = this.createForm.getRawValue();
    const now = new Date().toISOString();
    const householdId = createId();
    const household = {
      id: householdId,
      name: (value.householdName ?? '').trim(),
      type: (value.householdType ?? 'couple') as HouseholdType,
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
      inviteCodeExpiresAt: createInviteExpiry(1),
      currency: value.currency ?? 'USD'
    };

    this.appState.updateHouseholds([
      household,
      ...this.appState.households().filter((item) => item.id !== household.id)
    ]);

    this.auth.updateUser({
      ...activeUser,
      incomeMonthly: Number(value.incomeMonthly ?? activeUser.incomeMonthly),
      householdId,
      preferences: {
        ...activeUser.preferences,
        currency: value.currency ?? activeUser.preferences.currency,
        onboarded: true
      }
    });

    this.message = 'Household created. Invite your partner now, or finish and do it later from Profile.';
    this.step.set('invite');
  }

  async joinHousehold(): Promise<void> {
    this.message = '';
    if (this.joinForm.invalid) {
      this.joinForm.markAllAsTouched();
      return;
    }

    const activeUser = this.activeUser();
    if (!activeUser) {
      return;
    }

    const value = this.joinForm.getRawValue();
    const joinMessage = await this.membership.requestJoinByCode(value.code ?? '');
    this.message = joinMessage;
    if (!joinMessage.startsWith('Joined ')) {
      return;
    }

    const refreshedUser = this.auth.getActiveUser() ?? activeUser;
    this.auth.updateUser({
      ...refreshedUser,
      incomeMonthly: Number(value.incomeMonthly ?? activeUser.incomeMonthly),
      preferences: {
        ...refreshedUser.preferences,
        onboarded: true
      }
    });

    void this.router.navigate(['/household']);
  }

  async sendInvite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }

    const household = this.activeHousehold();
    const inviter = this.activeUser();
    const inviteEmail = (this.inviteForm.value.email ?? '').trim().toLowerCase();
    if (!household || !inviter || !inviteEmail) {
      return;
    }

    if (household.inviteCodeExpiresAt && new Date(household.inviteCodeExpiresAt).getTime() < Date.now()) {
      this.message = 'Invite code expired. Regenerate code before sending invites.';
      return;
    }

    try {
      await this.inviteEmailService.sendHouseholdInvite({
        toEmail: inviteEmail,
        householdName: household.name || 'Your Household',
        inviteCode: household.inviteCode,
        inviteLink: this.buildInviteLink(household.inviteCode),
        inviterName: inviter.name || 'TwoCents user'
      });

      this.appState.addInvite({
        id: createId(),
        householdId: household.id,
        email: inviteEmail,
        status: 'pending',
        sentAt: new Date().toISOString()
      });

      this.inviteForm.reset({ email: '' });
      this.message = `Invite sent to ${inviteEmail}.`;
    } catch (error: unknown) {
      this.message = error instanceof Error ? error.message : 'Failed to send invite email.';
    }
  }

  regenerateInviteCode(): void {
    const household = this.activeHousehold();
    if (!household) {
      return;
    }

    const next = {
      ...household,
      inviteCode: createInviteCode(),
      inviteCodeExpiresAt: createInviteExpiry(1)
    };

    this.appState.updateHouseholds(this.appState.households().map((item) => (item.id === next.id ? next : item)));
    this.message = 'New invite code generated. It will expire in one hour.';
  }

  async copyInviteLink(): Promise<void> {
    const household = this.activeHousehold();
    if (!household || !navigator?.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(this.buildInviteLink(household.inviteCode));
    this.message = 'Invite link copied.';
  }

  finish(): void {
    void this.router.navigate(['/household']);
  }

  private buildInviteLink(inviteCode: string): string {
    return `${window.location.origin}/#/auth?inviteCode=${encodeURIComponent(inviteCode)}`;
  }
}
