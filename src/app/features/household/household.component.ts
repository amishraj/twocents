import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { HouseholdMembershipService } from '../../core/services/household-membership.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';
import { ToastService } from '../../shared/toast/toast.service';

@Component({
  selector: 'app-household',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './household.component.html',
  styleUrl: './household.component.scss'
})
export class HouseholdComponent {
  private readonly fb = inject(FormBuilder);
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  private readonly membership = inject(HouseholdMembershipService);
  private readonly inviteFlow = inject(InviteFlowService);
  private readonly toast = inject(ToastService);

  contributionInput = signal<Record<string, number>>({});
  confirmLeave = signal(false);
  joinMessage = '';

  joinForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6)]]
  });

  activeUser = computed(() => this.auth.getActiveUser());

  household = computed(() => {
    const user = this.activeUser();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });

  showJoinCard = computed(() => {
    return !this.household();
  });

  canLeaveHousehold = computed(() => {
    const household = this.household();
    return Boolean(household);
  });

  members = computed(() => {
    const household = this.household();
    if (!household) {
      return [];
    }

    return household.members.map((member) => {
      const user = this.appState.userById(member.userId);
      return {
        ...member,
        incomeMonthly: user?.incomeMonthly ?? 0,
        email: user?.email ?? ''
      };
    });
  });

  monthlyHouseholdIncome = computed(() =>
    this.members().reduce((sum, member) => sum + member.incomeMonthly, 0)
  );

  memberContribution = computed(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sharedTx = this.appState
      .transactions()
      .filter((tx) => tx.scope === 'shared' && new Date(tx.date) >= monthStart);

    const totalSharedSpend = sharedTx.reduce((sum, tx) => sum + tx.amount, 0);
    return this.members().map((member) => {
      const spend = sharedTx
        .filter((tx) => tx.paidByUserId === member.userId)
        .reduce((sum, tx) => sum + tx.amount, 0);
      return {
        ...member,
        sharedSpend: spend,
        spendPct: totalSharedSpend > 0 ? Math.round((spend / totalSharedSpend) * 100) : 0,
        incomePct:
          this.monthlyHouseholdIncome() > 0
            ? Math.round((member.incomeMonthly / this.monthlyHouseholdIncome()) * 100)
            : 0
      };
    });
  });

  sharedBudgetSummaries = computed(() => {
    const now = new Date();
    return this.appState
      .budgets()
      .filter((budget) => budget.scope === 'shared')
      .map((budget) => {
        const start = new Date(now);
        if (budget.period === 'weekly') {
          start.setDate(now.getDate() - 6);
        } else {
          start.setDate(1);
          start.setHours(0, 0, 0, 0);
        }

        const spent = this.appState
          .transactions()
          .filter(
            (tx) =>
              tx.scope === 'shared' && tx.categoryId === budget.categoryId && new Date(tx.date) >= start
          )
          .reduce((sum, tx) => sum + tx.amount, 0);

        return {
          budget,
          category: this.appState.categoryById(budget.categoryId),
          spent,
          remaining: Math.max(budget.limit - spent, 0),
          percent: budget.limit > 0 ? Math.min(100, Math.round((spent / budget.limit) * 100)) : 0
        };
      });
  });

  sharedSavingsGoals = computed(() =>
    this.appState.savingsGoals().filter((goal) => goal.scope === 'shared')
  );

  recentHouseholdTransactions = computed(() => {
    const memberLookup = new Map(this.members().map((member) => [member.userId, member.displayName]));
    return this.appState
      .transactions()
      .filter((transaction) => transaction.scope === 'shared')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8)
      .map((transaction) => ({
        ...transaction,
        paidByName: memberLookup.get(transaction.paidByUserId) ?? 'Member',
        categoryName: this.appState.categoryById(transaction.categoryId)?.name ?? 'Uncategorized'
      }));
  });

  setContribution(goalId: string, value: string): void {
    const amount = Number(value);
    this.contributionInput.set({
      ...this.contributionInput(),
      [goalId]: Number.isFinite(amount) ? amount : 0
    });
  }

  addContribution(goalId: string): void {
    const amount = this.contributionInput()[goalId] ?? 0;
    if (amount <= 0) {
      return;
    }

    const nextGoals = this.appState.savingsGoals().map((goal) =>
      goal.id === goalId ? { ...goal, currentAmount: goal.currentAmount + amount } : goal
    );
    this.appState.updateSavings(nextGoals);
    this.contributionInput.set({
      ...this.contributionInput(),
      [goalId]: 0
    });
  }

  async joinHousehold(): Promise<void> {
    this.joinMessage = '';
    if (this.joinForm.invalid) {
      this.joinForm.markAllAsTouched();
      this.toast.warning('Please enter a valid invite code.');
      return;
    }

    this.joinMessage = await this.membership.requestJoinByCode(this.joinForm.value.code ?? '');
    this.toast.info(this.joinMessage);

    if (this.joinMessage.startsWith('Joined ') || this.joinMessage === 'You are already in this household.') {
      this.inviteFlow.clearPendingInviteCode();
    }

    this.joinForm.reset({ code: '' });
  }

  requestLeave(): void {
    this.confirmLeave.set(true);
  }

  cancelLeave(): void {
    this.confirmLeave.set(false);
  }

  leaveHousehold(): void {
    this.confirmLeave.set(false);
    this.joinMessage = this.membership.leaveCurrentHousehold();
    this.toast.info(this.joinMessage);
  }
}
