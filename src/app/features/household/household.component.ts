import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { HouseholdMembershipService } from '../../core/services/household-membership.service';
import { InsightsService } from '../../core/services/insights.service';
import { InviteCodeService } from '../../core/services/invite-code.service';
import { InviteEmailService } from '../../core/services/invite-email.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ToastService } from '../../shared/toast/toast.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { SheetComponent } from '../../shared/sheet/sheet.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { TransactionRowComponent } from '../../shared/transaction-row/transaction-row.component';
import { createId, createInviteCode, createInviteExpiry } from '../../core/utils/id';
import { todayLocalDate } from '../../core/utils/dates';
import { monthRange, rangeLabel, shortDate } from '../../core/utils/periods';
import { isExpense, isIncome, sortNewestFirst, sumAmounts, txInRange } from '../../core/utils/transactions';

@Component({
  selector: 'app-household',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    MoneyPipe,
    ConfirmModalComponent,
    SheetComponent,
    IconComponent,
    TransactionRowComponent
  ],
  templateUrl: './household.component.html',
  styleUrl: './household.component.scss'
})
export class HouseholdComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly membership = inject(HouseholdMembershipService);
  private readonly inviteEmail = inject(InviteEmailService);
  private readonly inviteCodes = inject(InviteCodeService);
  private readonly toast = inject(ToastService);
  readonly appState = inject(AppStateService);
  readonly insights = inject(InsightsService);
  readonly ui = inject(UiStateService);

  readonly renaming = signal(false);
  readonly inviting = signal(false);
  readonly confirmLeave = signal(false);
  readonly confirmCancelInviteId = signal<string | null>(null);
  readonly sendingInvite = signal(false);
  readonly copied = signal(false);

  readonly user = computed(() => this.auth.getActiveUser());
  readonly household = computed(() => {
    const user = this.user();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });
  readonly monthLabel = computed(() => rangeLabel(monthRange(todayLocalDate())));

  readonly members = computed(() => {
    const household = this.household();
    if (!household) {
      return [];
    }
    return household.members.map((member) => {
      const profile = this.appState.userById(member.userId);
      return {
        ...member,
        name: profile?.name || member.displayName,
        email: profile?.email ?? '',
        incomeMonthly: profile?.incomeMonthly ?? 0,
        initials: initials(profile?.name || member.displayName),
        isYou: member.userId === this.user()?.id
      };
    });
  });

  readonly myRole = computed(() => this.members().find((m) => m.isYou)?.role ?? 'member');
  readonly canManage = computed(() => this.myRole() === 'owner' || this.myRole() === 'manager');

  private readonly monthTx = computed(() => this.appState.transactions().filter((tx) => txInRange(tx, monthRange(todayLocalDate()))));
  readonly sharedExpenses = computed(() => this.monthTx().filter((tx) => tx.scope === 'shared' && isExpense(tx)));
  readonly sharedSpent = computed(() => sumAmounts(this.sharedExpenses()));
  readonly expectedIncome = computed(() => this.members().reduce((sum, m) => sum + m.incomeMonthly, 0));
  readonly loggedIncome = computed(() => {
    const monthStart = monthRange(todayLocalDate()).start;
    const legacy = this.appState
      .additionalIncome()
      .filter((e) => (e.date ?? '').slice(0, 10) >= monthStart)
      .reduce((sum, e) => sum + e.amount, 0);
    return sumAmounts(this.monthTx().filter(isIncome)) + legacy;
  });
  readonly spendOfIncomePercent = computed(() => {
    const income = this.expectedIncome();
    return income > 0 ? Math.min(100, Math.round((this.sharedSpent() / income) * 100)) : 0;
  });

  // Who paid what this month, versus an income-weighted "fair share".
  readonly contributions = computed(() => {
    const total = this.sharedSpent();
    const income = this.expectedIncome();
    const members = this.members();
    return members
      .map((member) => {
        const paid = sumAmounts(this.sharedExpenses().filter((tx) => tx.paidByUserId === member.userId));
        const paidShare = total > 0 ? paid / total : 0;
        const fairShare = income > 0 ? member.incomeMonthly / income : members.length > 0 ? 1 / members.length : 0;
        return {
          ...member,
          paid,
          paidShare,
          fairShare,
          fairAmount: total * fairShare,
          difference: paid - total * fairShare
        };
      })
      .sort((a, b) => b.paid - a.paid);
  });

  readonly sharedBudgets = computed(() => this.insights.budgetSummaries().filter((s) => s.budget.scope === 'shared'));
  readonly sharedGoals = computed(() =>
    this.appState
      .savingsGoals()
      .filter((g) => g.scope === 'shared')
      .map((goal) => ({ goal, percent: goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0 }))
  );
  readonly recentShared = computed(() =>
    sortNewestFirst(this.appState.transactions().filter((tx) => tx.scope === 'shared')).slice(0, 8)
  );

  readonly pendingInvites = computed(() => {
    const household = this.household();
    return household ? this.appState.invites().filter((i) => i.householdId === household.id && i.status === 'pending') : [];
  });

  readonly inviteExpiry = computed(() => {
    const expires = this.household()?.inviteCodeExpiresAt;
    if (!expires) {
      return { expired: false, label: '' };
    }
    const ms = new Date(expires).getTime() - Date.now();
    if (ms <= 0) {
      return { expired: true, label: 'expired' };
    }
    const minutes = Math.round(ms / 60_000);
    return { expired: false, label: minutes >= 60 ? `expires in ${Math.round(minutes / 60)}h` : `expires in ${minutes} min` };
  });

  renameForm = this.fb.group({ name: ['', Validators.required] });
  inviteForm = this.fb.group({ email: ['', [Validators.required, Validators.email]] });

  memberName(userId: string): string {
    return this.members().find((m) => m.userId === userId)?.name ?? '';
  }

  joinedLabel(iso: string): string {
    return iso ? shortDate(iso.slice(0, 10), true) : '';
  }

  logIncome(): void {
    this.ui.openQuickAdd({ type: 'income' });
  }

  logSharedExpense(): void {
    this.ui.openQuickAdd({ type: 'expense' });
  }

  // ── Rename ──
  openRename(): void {
    this.renameForm.reset({ name: this.household()?.name ?? '' });
    this.renaming.set(true);
  }

  saveName(): void {
    const household = this.household();
    const name = (this.renameForm.value.name ?? '').trim();
    if (!household || !name) {
      this.renameForm.markAllAsTouched();
      return;
    }
    this.appState.updateHouseholds(this.appState.households().map((h) => (h.id === household.id ? { ...h, name } : h)));
    this.renaming.set(false);
    this.toast.success('Household renamed.');
  }

  // ── Invites ──
  openInvite(): void {
    this.inviteForm.reset({ email: '' });
    this.copied.set(false);
    this.inviting.set(true);
  }

  inviteLink(): string {
    const code = this.household()?.inviteCode ?? '';
    return `${window.location.origin}/#/auth?inviteCode=${encodeURIComponent(code)}`;
  }

  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteLink());
      this.copied.set(true);
      this.toast.success('Invite link copied.');
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.toast.warning('Could not copy. Select the code and copy it manually.');
    }
  }

  async regenerateCode(): Promise<void> {
    const household = this.household();
    const user = this.user();
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
      this.toast.success('New invite code generated. It is valid for 24 hours.');
    } catch {
      this.toast.error('The new code could not be registered. Please try again.');
    }
  }

  async sendInvite(): Promise<void> {
    const household = this.household();
    const email = (this.inviteForm.value.email ?? '').trim().toLowerCase();
    if (!household || this.inviteForm.invalid || !email) {
      this.inviteForm.markAllAsTouched();
      return;
    }
    if (this.inviteExpiry().expired) {
      this.toast.warning('The invite code has expired. Generate a new one first.');
      return;
    }
    if (this.pendingInvites().some((i) => i.email === email)) {
      this.toast.info(`An invite for ${email} is already pending.`);
      return;
    }
    if (this.members().some((m) => m.email.toLowerCase() === email)) {
      this.toast.info(`${email} is already a member.`);
      return;
    }
    this.sendingInvite.set(true);
    try {
      await this.inviteEmail.sendHouseholdInvite({
        toEmail: email,
        householdName: household.name || 'our household',
        inviteCode: household.inviteCode,
        inviteLink: this.inviteLink(),
        inviterName: this.user()?.name || 'A TwoCents user'
      });
      this.appState.addInvite({ id: createId(), householdId: household.id, email, status: 'pending', sentAt: new Date().toISOString() });
      this.inviteForm.reset({ email: '' });
      this.toast.success(`Invite sent to ${email}.`);
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'The invite email could not be sent.');
    } finally {
      this.sendingInvite.set(false);
    }
  }

  cancelInvite(): void {
    const id = this.confirmCancelInviteId();
    if (!id) {
      return;
    }
    this.appState.removeInvite(id);
    this.confirmCancelInviteId.set(null);
    this.toast.success('Invite cancelled.');
  }

  // ── Leave ──
  readonly leaveBlocked = computed(() => {
    const members = this.members();
    return this.myRole() === 'owner' && members.length > 1;
  });

  async leave(): Promise<void> {
    this.confirmLeave.set(false);
    const message = await this.membership.leaveCurrentHousehold();
    if (message.startsWith('You left')) {
      this.toast.success(message);
    } else {
      this.toast.warning(message);
    }
  }
}

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
};
