import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AppStateService } from '../../core/services/app-state.service';
import { HouseholdType } from '../../core/models/app.models';
import { HouseholdMembershipService } from '../../core/services/household-membership.service';
import { InviteEmailService } from '../../core/services/invite-email.service';
import { InviteCodeService } from '../../core/services/invite-code.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';
import { createId, createInviteCode, createInviteExpiry } from '../../core/utils/id';
import { normalizeAmount } from '../../core/utils/money';
import { IconComponent } from '../../shared/icon/icon.component';

type OnboardingStep = 'choice' | 'create' | 'join' | 'invite';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
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
  private readonly inviteCodes = inject(InviteCodeService);
  private readonly inviteFlow = inject(InviteFlowService);

  readonly step = signal<OnboardingStep>('choice');
  readonly busy = signal(false);
  readonly currencies = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'CHF', 'SGD', 'NZD'];
  message = '';
  messageIsError = false;

  readonly activeUser = computed(() => this.auth.getActiveUser());
  readonly activeHousehold = computed(() => {
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

  constructor() {
    // Arrived through an invite link: jump straight to the join step.
    const pending = this.inviteFlow.pendingInviteCode();
    if (pending) {
      this.joinForm.patchValue({ code: pending });
      this.step.set('join');
    }
    // Already in a household (e.g. re-opened this page): go to the invite step.
    if (this.activeHousehold()) {
      this.step.set('invite');
    }
  }

  private setMessage(text: string, isError = false): void {
    this.message = text;
    this.messageIsError = isError;
  }

  chooseCreate(): void {
    this.setMessage('');
    this.step.set('create');
  }

  chooseJoin(): void {
    this.setMessage('');
    this.step.set('join');
  }

  backToChoice(): void {
    this.setMessage('');
    this.step.set('choice');
  }

  skipForNow(): void {
    const user = this.activeUser();
    if (!user) {
      return;
    }
    this.auth.updateUser({ ...user, preferences: { ...user.preferences, onboarded: true } });
    void this.router.navigate(['/dashboard']);
  }

  async createHousehold(): Promise<void> {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      this.setMessage('Give your household a name to continue.', true);
      return;
    }
    const user = this.activeUser();
    if (!user) {
      return;
    }
    this.busy.set(true);
    const value = this.createForm.getRawValue();
    const now = new Date().toISOString();
    const householdId = createId();
    const inviteCode = createInviteCode();
    const inviteCodeExpiresAt = createInviteExpiry(24);
    const ownerEntry = { role: 'owner' as const, displayName: user.name, joinedAt: now };
    const household = {
      id: householdId,
      name: (value.householdName ?? '').trim(),
      type: (value.householdType ?? 'couple') as HouseholdType,
      members: [{ userId: user.id, ...ownerEntry }],
      membersByUid: { [user.id]: ownerEntry },
      sharedBudgetEnabled: true,
      inviteCode,
      inviteCodeExpiresAt,
      currency: value.currency ?? 'USD'
    };
    const owner = {
      ...user,
      incomeMonthly: normalizeAmount(value.incomeMonthly ?? user.incomeMonthly),
      householdId,
      preferences: { ...user.preferences, currency: value.currency ?? user.preferences.currency, onboarded: true }
    };

    try {
      await this.appState.createHouseholdWithOwner(household, owner);
    } catch {
      this.busy.set(false);
      this.setMessage('Could not create your household. Check your connection and try again.', true);
      return;
    }
    try {
      await this.inviteCodes.writeInviteCode({ code: inviteCode, householdId, expiresAt: inviteCodeExpiresAt, createdByUid: user.id });
    } catch {
      // Non-fatal: the owner can generate a fresh code from the Household page.
    }
    await this.appState.refreshDataScope();
    this.busy.set(false);
    this.setMessage('');
    this.step.set('invite');
  }

  async joinHousehold(): Promise<void> {
    this.setMessage('');
    if (this.joinForm.invalid) {
      this.joinForm.markAllAsTouched();
      this.setMessage('Enter the invite code you were given.', true);
      return;
    }
    const user = this.activeUser();
    if (!user) {
      return;
    }
    this.busy.set(true);
    const value = this.joinForm.getRawValue();
    const result = await this.membership.requestJoinByCode(value.code ?? '');
    if (!result.startsWith('Joined')) {
      this.busy.set(false);
      this.setMessage(result, true);
      return;
    }
    this.inviteFlow.clearPendingInviteCode();
    const refreshed = this.auth.getActiveUser() ?? user;
    this.auth.updateUser({
      ...refreshed,
      incomeMonthly: normalizeAmount(value.incomeMonthly ?? user.incomeMonthly),
      preferences: { ...refreshed.preferences, onboarded: true }
    });
    this.busy.set(false);
    void this.router.navigate(['/household']);
  }

  async sendInvite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      this.setMessage('Enter a valid email address.', true);
      return;
    }
    const household = this.activeHousehold();
    const inviter = this.activeUser();
    const email = (this.inviteForm.value.email ?? '').trim().toLowerCase();
    if (!household || !inviter || !email) {
      return;
    }
    if (household.inviteCodeExpiresAt && new Date(household.inviteCodeExpiresAt).getTime() < Date.now()) {
      this.setMessage('The invite code has expired. Generate a new one first.', true);
      return;
    }
    this.busy.set(true);
    try {
      await this.inviteEmailService.sendHouseholdInvite({
        toEmail: email,
        householdName: household.name || 'our household',
        inviteCode: household.inviteCode,
        inviteLink: this.buildInviteLink(household.inviteCode),
        inviterName: inviter.name || 'A TwoCents user'
      });
      this.appState.addInvite({ id: createId(), householdId: household.id, email, status: 'pending', sentAt: new Date().toISOString() });
      this.inviteForm.reset({ email: '' });
      this.setMessage(`Invite sent to ${email}.`);
    } catch (error) {
      this.setMessage(error instanceof Error ? error.message : 'The invite email could not be sent.', true);
    } finally {
      this.busy.set(false);
    }
  }

  async regenerateInviteCode(): Promise<void> {
    const household = this.activeHousehold();
    const user = this.activeUser();
    if (!household || !user) {
      return;
    }
    const code = createInviteCode();
    const expiresAt = createInviteExpiry(24);
    this.appState.updateHouseholds(
      this.appState.households().map((h) => (h.id === household.id ? { ...h, inviteCode: code, inviteCodeExpiresAt: expiresAt } : h))
    );
    try {
      await this.inviteCodes.writeInviteCode({ code, householdId: household.id, expiresAt, createdByUid: user.id });
      this.setMessage('New invite code generated. Valid for 24 hours.');
    } catch {
      this.setMessage('The new code could not be registered. Try again.', true);
    }
  }

  async copyInviteLink(): Promise<void> {
    const household = this.activeHousehold();
    if (!household) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.buildInviteLink(household.inviteCode));
      this.setMessage('Invite link copied.');
    } catch {
      this.setMessage('Could not copy automatically. Share the code above instead.', true);
    }
  }

  finish(): void {
    void this.router.navigate(['/household']);
  }

  private buildInviteLink(inviteCode: string): string {
    return `${window.location.origin}/#/auth?inviteCode=${encodeURIComponent(inviteCode)}`;
  }
}
