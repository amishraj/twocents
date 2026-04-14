import { AfterViewInit, Component, computed, effect, inject, signal, ViewChildren, QueryList, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { HouseholdMembershipService } from '../../core/services/household-membership.service';
import { InviteFlowService } from '../../core/services/invite-flow.service';
import { ToastService } from '../../shared/toast/toast.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { TransactionRowComponent } from '../../shared/transaction-row/transaction-row.component';
import {
  Chart,
  DoughnutController,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';

Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

@Component({
  selector: 'app-household',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ConfirmModalComponent, TransactionRowComponent],
  templateUrl: './household.component.html',
  styleUrl: './household.component.scss'
})
export class HouseholdComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('budgetGaugeCanvas') budgetGaugeRefs!: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChild('incomeGaugeCanvas') incomeGaugeRef?: ElementRef<HTMLCanvasElement>;
  private budgetCharts: Chart<'doughnut'>[] = [];
  private incomeChart: Chart<'doughnut'> | null = null;

  private readonly fb = inject(FormBuilder);
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  private readonly membership = inject(HouseholdMembershipService);
  private readonly inviteFlow = inject(InviteFlowService);
  private readonly toast = inject(ToastService);

  constructor() {
    effect(() => {
      void this.incomeChartReady();
      const pct = this.monthlySpendPercent();
      const spent = this.monthlySharedSpend();
      const income = this.monthlyHouseholdIncome();
      if (this.incomeChart) {
        this.incomeChart.data.datasets[0].data = [spent, Math.max(0, income - spent)];
        const themeColor = this.auth.getActiveUser()?.preferences.themeColor ?? '#0284c7';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.incomeChart.data.datasets[0] as any).backgroundColor = [
          this.getHealthColor(pct, themeColor),
          '#e0f2fe'
        ];
        this.incomeChart.update('none');
      }
    });
  }

  contributionInput = signal<Record<string, number>>({});
  confirmLeave = signal(false);
  showIncomeForm = signal(false);
  incomeSourceInput = signal('');
  incomeAmountInput = signal<number | null>(null);
  incomeChartReady = signal(0);

  private readonly todayStr = new Date().toISOString().split('T')[0];
  private readonly yesterdayStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  })();

  private mapTransaction(transaction: ReturnType<typeof this.appState.transactions>[0]) {
    const memberLookup = new Map(this.members().map((m) => [m.userId, m.displayName]));
    return {
      ...transaction,
      paidByName: memberLookup.get(transaction.paidByUserId) ?? 'Member',
      categoryName: this.appState.categoryById(transaction.categoryId)?.name ?? 'Uncategorized'
    };
  }
  joinModalOpen = signal(false);
  joinMessage = '';

  joinForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6)]]
  });

  householdNameForm = this.fb.group({
    name: ['', Validators.required]
  });

  activeUser = computed(() => this.auth.getActiveUser());

  household = computed(() => {
    const user = this.activeUser();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });

  canAttemptJoin = computed(() => !this.household());

  joinDisabledReason = computed(() =>
    this.household()
      ? 'You are already part of a household. Leave your current household before joining another one.'
      : ''
  );

  needsHouseholdName = computed(() => {
    const household = this.household();
    return Boolean(household && (!household.name || household.name.trim().length === 0));
  });

  canLeaveHousehold = computed(() => {
    const household = this.household();
    return Boolean(household);
  });

  leaveBlockedByConsent = computed(() => {
    const household = this.household();
    const user = this.activeUser();
    if (!household || !user) {
      return false;
    }

    const currentMember = household.members.find((member) => member.userId === user.id);
    const hasOtherMembers = household.members.some((member) => member.userId !== user.id);
    return currentMember?.role === 'owner' && hasOtherMembers;
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

  monthlyHouseholdIncome = computed(() => {
    const baseIncome = this.members().reduce((sum, member) => sum + member.incomeMonthly, 0);
    const additionalIncome = this.totalAdditionalIncomeThisMonth();
    return baseIncome + additionalIncome;
  });

  monthlySharedSpend = computed(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.appState
      .transactions()
      .filter((tx) => tx.scope === 'shared' && new Date(tx.date) >= monthStart)
      .reduce((sum, tx) => sum + tx.amount, 0);
  });

  monthlySpendPercent = computed(() => {
    const income = this.monthlyHouseholdIncome();
    if (income <= 0) return 0;
    return Math.min(100, Math.round((this.monthlySharedSpend() / income) * 100));
  });

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

  additionalIncomeEntries = computed(() => {
    const household = this.household();
    if (!household) return [];
    return this.appState.additionalIncome()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  allMembersAdditionalIncomeThisMonth = computed(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const allEntries = this.appState.additionalIncome().filter((e) => new Date(e.date) >= monthStart);
    
    return this.members().map((member) => {
      const memberEntries = allEntries.filter((e) => e.userId === member.userId);
      const memberTotal = memberEntries.reduce((sum, e) => sum + e.amount, 0);
      return {
        ...member,
        additionalIncome: memberTotal,
        entries: memberEntries
      };
    });
  });

  totalAdditionalIncomeThisMonth = computed(() => {
    return this.allMembersAdditionalIncomeThisMonth().reduce((sum, m) => sum + m.additionalIncome, 0);
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

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initIncomeChart();
      this.incomeChartReady.update(v => v + 1);
      this.initBudgetCharts();
    }, 0);
  }

  ngOnDestroy(): void {
    for (const chart of this.budgetCharts) {
      chart.destroy();
    }
    this.budgetCharts = [];
    this.incomeChart?.destroy();
    this.incomeChart = null;
  }

  private initIncomeChart(): void {
    const canvas = this.incomeGaugeRef?.nativeElement;
    if (!canvas) return;

    const themeColor = this.auth.getActiveUser()?.preferences.themeColor ?? '#0284c7';

    this.incomeChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Spent', 'Remaining'],
        datasets: [{
          data: [this.monthlySharedSpend(), Math.max(0, this.monthlyHouseholdIncome() - this.monthlySharedSpend())],
          backgroundColor: [this.getHealthColor(this.monthlySpendPercent(), themeColor), '#e0f2fe'],
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 4
        }]
      },
      options: {
        cutout: '70%',
        responsive: true,
        maintainAspectRatio: true,
        animation: { animateRotate: true, animateScale: false, duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
  }

  private initBudgetCharts(): void {
    const canvases = this.budgetGaugeRefs?.toArray() ?? [];
    const budgetData = this.sharedBudgetSummaries();

    for (let i = 0; i < Math.min(canvases.length, budgetData.length); i++) {
      const canvas = canvases[i].nativeElement;
      const item = budgetData[i];

      const chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: [item.category?.name ?? 'Budget', 'Remaining'],
          datasets: [
            {
              data: [item.percent, 100 - item.percent],
              backgroundColor: [this.getHealthColor(item.percent, item.category?.color ?? '#0ea5e9'), '#f1f5f9'],
              borderWidth: 0,
              hoverOffset: 4
            }
          ]
        },
        options: {
          cutout: '70%',
          responsive: true,
          maintainAspectRatio: true,
          animation: { animateRotate: true, animateScale: false, duration: 600 },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false }
          }
        }
      });

      this.budgetCharts.push(chart);
    }
  }

  getHealthColor(percent: number, categoryColor: string): string {
    if (percent >= 100) return '#dc2626';
    if (percent >= 85) return '#d97706';
    return categoryColor;
  }

  sharedGoalProgress(goalId: string): number {
    const goal = this.sharedSavingsGoals().find((item) => item.id === goalId);
    if (!goal || goal.targetAmount <= 0) {
      return 0;
    }

    return Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
  }

  sharedGoalProgressColor(goalId: string): string {
    const progress = this.sharedGoalProgress(goalId);
    const hue = Math.max(0, Math.min(120, Math.round((progress / 100) * 120)));
    return `hsl(${hue} 78% 48%)`;
  }

  sharedGoalTone(goalId: string): 'danger' | 'warning' | 'success' {
    const progress = this.sharedGoalProgress(goalId);
    if (progress >= 80) {
      return 'success';
    }
    if (progress >= 40) {
      return 'warning';
    }
    return 'danger';
  }

  sharedGoalStatus(goalId: string): string {
    const tone = this.sharedGoalTone(goalId);
    if (tone === 'success') {
      return 'Near goal';
    }
    if (tone === 'warning') {
      return 'On track';
    }
    return 'Behind';
  }

  recentHouseholdTransactions = computed(() => {
    return this.appState
      .transactions()
      .filter((tx) => tx.scope === 'shared')
      .filter((tx) => {
        const d = tx.date.substring(0, 10);
        return d === this.todayStr || d === this.yesterdayStr;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 8)
      .map((tx) => this.mapTransaction(tx));
  });

  upcomingHouseholdTransactions = computed(() => {
    return this.appState
      .transactions()
      .filter((tx) => tx.scope === 'shared')
      .filter((tx) => tx.date.substring(0, 10) > this.todayStr)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 8)
      .map((tx) => this.mapTransaction(tx));
  });

  toggleIncomeForm(): void {
    this.showIncomeForm.set(!this.showIncomeForm());
  }

  addAdditionalIncome(): void {
    const user = this.activeUser();
    const household = this.household();
    if (!user || !household) return;
    const source = this.incomeSourceInput().trim();
    const amount = this.incomeAmountInput();
    if (!source || !amount || amount <= 0) {
      this.toast.warning('Please enter a source and amount.');
      return;
    }
    const entry = {
      id: crypto.randomUUID(),
      userId: user.id,
      householdId: household.id,
      source,
      amount,
      date: new Date().toISOString()
    };
    this.appState.addAdditionalIncome(entry);
    this.incomeSourceInput.set('');
    this.incomeAmountInput.set(null);
    this.showIncomeForm.set(false);
    this.toast.success(`Added $${amount} from ${source}.`);
  }

  removeAdditionalIncome(entryId: string): void {
    this.appState.deleteAdditionalIncome(entryId);
    this.toast.success('Income entry removed.');
  }

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

    const added = this.appState.addSavingsContribution(goalId, amount, this.activeUser()?.id);
    if (!added) {
      this.toast.warning('Unable to add contribution right now.');
      return;
    }

    this.contributionInput.set({
      ...this.contributionInput(),
      [goalId]: 0
    });
    this.toast.success(`$${amount} contributed.`);
  }

  openJoinModal(): void {
    this.joinMessage = '';
    this.joinModalOpen.set(true);
  }

  closeJoinModal(): void {
    this.joinModalOpen.set(false);
  }

  saveHouseholdName(): void {
    const household = this.household();
    if (!household || this.householdNameForm.invalid) {
      this.householdNameForm.markAllAsTouched();
      return;
    }

    const name = (this.householdNameForm.value.name ?? '').trim();
    if (!name) {
      return;
    }

    const next = { ...household, name };
    this.appState.updateHouseholds(
      this.appState.households().map((item) => (item.id === next.id ? next : item))
    );
    this.householdNameForm.reset({ name: '' });
    this.toast.success('Household name saved.');
  }

  async joinHousehold(): Promise<void> {
    this.joinMessage = '';
    if (!this.canAttemptJoin()) {
      this.joinMessage = this.joinDisabledReason();
      this.toast.warning(this.joinMessage);
      return;
    }

    if (this.joinForm.invalid) {
      this.joinForm.markAllAsTouched();
      this.toast.warning('Please enter a valid invite code.');
      return;
    }

    this.joinMessage = await this.membership.requestJoinByCode(this.joinForm.value.code ?? '');
    this.toast.info(this.joinMessage);

    if (this.joinMessage.startsWith('Joined ') || this.joinMessage === 'You are already in this household.') {
      this.inviteFlow.clearPendingInviteCode();
      this.joinModalOpen.set(false);
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
