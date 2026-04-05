import { Component, computed, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { Budget, Transaction } from '../../core/models/app.models';
import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';

Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  @ViewChild('spendChart', { static: true }) spendChartRef!: ElementRef<HTMLCanvasElement>;
  private chart: Chart<'doughnut'> | null = null;

  /** Arc length of the semicircle (π × r, where r = 50) */
  readonly arcLength = Math.PI * 50;

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

  totalSpend = computed(() => this.categorySpend().reduce((sum, item) => sum + item.amount, 0));

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

    effect(() => {
      const data = this.categorySpend();
      if (this.chart) {
        this.chart.data.labels = data.map((i) => i.category?.name ?? '');
        this.chart.data.datasets[0].data = data.map((i) => i.amount);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.chart.data.datasets[0] as any).backgroundColor = data.map(
          (i) => i.category?.color ?? '#888'
        );
        this.chart.update('active');
      }
    });
  }

  ngAfterViewInit(): void {
    this.initChart();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  setRange(range: 'week' | 'month'): void {
    this.ui.setRange(range);
  }

  /** Returns the stroke-dashoffset for a semicircle gauge at a given percent. */
  getArcOffset(percent: number): number {
    return this.arcLength * (1 - Math.min(percent, 100) / 100);
  }

  /** Returns a health-aware color: category color below 85%, amber at 85-99%, red at 100%+. */
  getHealthColor(percent: number, categoryColor: string): string {
    if (percent >= 100) return '#dc2626';
    if (percent >= 85) return '#d97706';
    return categoryColor;
  }

  private initChart(): void {
    const canvas = this.spendChartRef?.nativeElement;
    if (!canvas) return;

    const data = this.categorySpend();

    this.chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map((i) => i.category?.name ?? ''),
        datasets: [
          {
            data: data.map((i) => i.amount),
            backgroundColor: data.map((i) => i.category?.color ?? '#888'),
            borderWidth: 3,
            borderColor: '#ffffff',
            hoverOffset: 12
          }
        ]
      },
      options: {
        cutout: '68%',
        responsive: true,
        maintainAspectRatio: true,
        animation: { animateRotate: true, duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.88)',
            titleFont: { family: 'Inter', size: 13, weight: 'bold' },
            bodyFont: { family: 'Inter', size: 12 },
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (context) => {
                const total = (context.dataset.data as number[]).reduce((a, b) => a + b, 0);
                const value = context.raw as number;
                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                return `  $${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}  ·  ${pct}%`;
              }
            }
          }
        }
      }
    });
  }

  private buildBudgetProgress(
    budget: Budget,
    transactions: Transaction[]
  ): {
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
