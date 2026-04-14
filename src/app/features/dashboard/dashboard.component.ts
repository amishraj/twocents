import { Component, computed, signal, ViewChildren, QueryList, AfterViewInit, OnDestroy, effect, inject, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { Budget, Transaction } from '../../core/models/app.models';
import { TransactionRowComponent } from '../../shared/transaction-row/transaction-row.component';
import {
  Chart,
  DoughnutController,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  TooltipItem
} from 'chart.js';

Chart.register(DoughnutController, ArcElement, Tooltip, Legend, CategoryScale, LinearScale);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, TransactionRowComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('spendChartCanvas') spendChartRef!: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChildren('budgetGaugeCanvas') budgetGaugeRefs!: QueryList<ElementRef<HTMLCanvasElement>>;

  private _spendChart: Chart<'doughnut'> | null = null;
  readonly budgetCharts: Chart<'doughnut'>[] = [];
  readonly selectedCategories = signal(new Set<string>());

  get hasCategoryFilter(): boolean {
    return this.selectedCategories().size > 0;
  }

  get spendChart(): Chart<'doughnut'> | null { return this._spendChart; }

  activeUser = computed(() => this.auth.getActiveUser());
  household = computed(() => {
    const user = this.activeUser();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });

  recentTransactions = computed(() =>
    this.appState
      .transactions()
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10)
  );

  rangeTransactions = computed(() => {
    const range = this.ui.dashboardRange();
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - (range === 'week' ? 6 : 29));
    return this.appState
      .transactions()
      .filter((transaction) => new Date(transaction.date) >= start)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
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
      .sort((a, b) => b.amount - a.amount);
  });

  filteredCategorySpend = computed(() => {
    const selected = this.selectedCategories();
    if (selected.size === 0) return this.categorySpend();
    return this.categorySpend().filter((item) => selected.has(item.category!.id));
  });

  totalSpend = computed(() => this.filteredCategorySpend().reduce((sum, item) => sum + item.amount, 0));

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
      const budgetData = this.budgetProgress();
      for (let i = 0; i < budgetData.length; i++) {
        const item = budgetData[i];
        const chart = this.budgetCharts[i];
        if (chart) {
          chart.data.datasets[0].data = [item.percent, 100 - item.percent];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (chart.data.datasets[0] as any).backgroundColor = [
            this.getHealthColor(item.percent, item.color),
            '#f1f5f9'
          ];
          chart.update('none');
        }
      }
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initSpendChart();
      this.initBudgetCharts();
    }, 0);
  }

  ngOnDestroy(): void {
    this._spendChart?.destroy();
    for (const chart of this.budgetCharts) {
      chart.destroy();
    }
    this._spendChart = null;
    this.budgetCharts.splice(0);
  }

  setRange(range: 'week' | 'month'): void {
    this.ui.setRange(range);
  }

  toggleCategory(categoryId: string): void {
    const current = new Set(this.selectedCategories());
    if (current.has(categoryId)) {
      current.delete(categoryId);
    } else {
      current.add(categoryId);
    }
    this.selectedCategories.set(current);
    this.updateSpendChart();
  }

  clearCategoryFilter(): void {
    this.selectedCategories.set(new Set());
    this.updateSpendChart();
  }

  private updateSpendChart(): void {
    const data = this.filteredCategorySpend();
    if (!this._spendChart) return;
    this._spendChart.data.labels = data.map((i) => i.category?.name ?? '');
    this._spendChart.data.datasets[0].data = data.map((i) => i.amount);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this._spendChart.data.datasets[0] as any).backgroundColor = data.map(
      (i) => i.category?.color ?? '#888'
    );
    this._spendChart.update('active');
  }

  isCategorySelected(categoryId: string): boolean {
    const selected = this.selectedCategories();
    if (selected.size === 0) return true;
    return selected.has(categoryId);
  }

  getHealthColor(percent: number, categoryColor: string): string {
    if (percent >= 100) return '#dc2626';
    if (percent >= 85) return '#d97706';
    return categoryColor;
  }

  private initSpendChart(): void {
    const canvas = this.spendChartRef?.first?.nativeElement;
    if (!canvas) return;

    const data = this.filteredCategorySpend();

    this._spendChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map((i) => i.category?.name ?? ''),
        datasets: [
          {
            data: data.map((i) => i.amount),
            backgroundColor: data.map((i) => i.category?.color ?? '#888'),
            borderWidth: 2,
            borderColor: '#ffffff',
            hoverOffset: 0
          }
        ]
      },
      options: {
        cutout: '68%',
        responsive: true,
        maintainAspectRatio: true,
        animation: { animateRotate: true, animateScale: false, duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            titleFont: { family: 'Inter', size: 12, weight: 'bold' },
            bodyFont: { family: 'Inter', size: 12, weight: 'normal' },
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (context: TooltipItem<'doughnut'>) => {
                const total = (context.dataset.data as number[]).reduce((a, b) => a + b, 0);
                const value = context.raw as number;
                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                const formatted = value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                return `$${formatted}  ·  ${pct}%`;
              }
            }
          }
        }
      }
    });
  }

  private initBudgetCharts(): void {
    const canvases = this.budgetGaugeRefs?.toArray() ?? [];
    const budgetData = this.budgetProgress();

    for (let i = 0; i < Math.min(canvases.length, budgetData.length); i++) {
      const canvas = canvases[i].nativeElement;
      const item = budgetData[i];

      const chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: [item.categoryName, 'Remaining'],
          datasets: [
            {
              data: [item.percent, 100 - item.percent],
              backgroundColor: [this.getHealthColor(item.percent, item.color), '#f1f5f9'],
              borderWidth: 0,
              hoverOffset: 6
            }
          ]
        },
        options: {
          cutout: '72%',
          responsive: true,
          maintainAspectRatio: true,
          animation: { animateRotate: true, animateScale: false, duration: 600 },
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: false
            }
          }
        }
      });

      this.budgetCharts.push(chart);
    }
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
