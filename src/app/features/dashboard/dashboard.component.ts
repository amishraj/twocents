import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { Budget, Transaction } from '../../core/models/app.models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  activeUser = computed(() => this.auth.getActiveUser());
  household = computed(() => {
    const user = this.activeUser();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });

  recentTransactions = computed(() => this.appState.transactions().slice(0, 10));

  rangeTransactions = computed(() => {
    const range = this.ui.dashboardRange();
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - (range === 'week' ? 6 : 29));
    return this.appState
      .transactions()
      .filter((transaction) => new Date(transaction.date) >= start)
      .slice(0, 12);
  });

  categorySpend = computed(() => {
    const totals = new Map<string, number>();
    for (const transaction of this.rangeTransactions()) {
      totals.set(transaction.categoryId, (totals.get(transaction.categoryId) ?? 0) + transaction.amount);
    }

    return Array.from(totals.entries())
      .map(([categoryId, amount]) => ({
        category: this.appState.categoryById(categoryId),
        amount
      }))
      .filter((item) => item.category)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  });

  maxSpend = computed(() => {
    const amounts = this.categorySpend().map((item) => item.amount);
    return amounts.length ? Math.max(...amounts) : 1;
  });

  budgetProgress = computed(() => {
    const budgets = this.appState.budgets();
    const transactions = this.rangeTransactions();
    return budgets.map((budget) => this.buildBudgetProgress(budget, transactions));
  });

  constructor(
    public appState: AppStateService,
    private auth: AuthService,
    public ui: UiStateService
  ) {
    void this.appState.ensureRecurringUpToDate();
  }

  setRange(range: 'week' | 'month'): void {
    this.ui.setRange(range);
  }

  private buildBudgetProgress(budget: Budget, transactions: Transaction[]): {
    budget: Budget;
    categoryName: string;
    color: string;
    spent: number;
    percent: number;
  } {
    const spent = transactions
      .filter((item) => item.categoryId === budget.categoryId)
      .reduce((sum, item) => sum + item.amount, 0);
    const category = this.appState.categoryById(budget.categoryId);
    const percent = budget.limit ? Math.min(100, Math.round((spent / budget.limit) * 100)) : 0;

    return {
      budget,
      categoryName: category?.name ?? 'Category',
      color: category?.color ?? '#0ea5e9',
      spent,
      percent
    };
  }
}
