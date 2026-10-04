import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
} from 'chart.js';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { InsightsService } from '../../core/services/insights.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { Transaction } from '../../core/models/app.models';
import { todayLocalDate } from '../../core/utils/dates';
import { shortDate } from '../../core/utils/periods';
import { ScopeFilter, sortNewestFirst, txLocalDate } from '../../core/utils/transactions';
import { TransactionRowComponent } from '../../shared/transaction-row/transaction-row.component';
import { IconComponent } from '../../shared/icon/icon.component';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, DecimalPipe, MoneyPipe, TransactionRowComponent, IconComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  @ViewChild('trendCanvas') trendCanvas?: ElementRef<HTMLCanvasElement>;

  readonly appState = inject(AppStateService);
  readonly ui = inject(UiStateService);
  readonly insights = inject(InsightsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly currency = inject(CurrencyService);

  private chart: Chart<'line'> | null = null;
  readonly showAllCategories = signal(false);

  readonly user = computed(() => this.auth.getActiveUser());
  readonly household = computed(() => {
    const user = this.user();
    return user ? this.appState.householdById(user.householdId) : undefined;
  });
  readonly hasHousehold = computed(() => Boolean(this.user()?.householdId?.trim()));
  readonly firstName = computed(() => (this.user()?.name ?? '').trim().split(/\s+/)[0] || '');

  readonly loaded = computed(() => this.appState.transactionsLoaded());
  readonly isEmpty = computed(() => this.loaded() && this.appState.transactions().length === 0);

  readonly range = this.ui.range;
  readonly scope = this.ui.scopeFilter;

  readonly summary = computed(() => this.insights.periodSummary(this.range(), this.ui.previousPeriod(), this.scope()));

  readonly spentDelta = computed(() => {
    const s = this.summary();
    if (s.previousSpent <= 0) {
      return null;
    }
    return Math.round(((s.spent - s.previousSpent) / s.previousSpent) * 100);
  });

  readonly categories = computed(() => this.insights.categoryTotals(this.range(), this.scope()));
  readonly visibleCategories = computed(() =>
    this.showAllCategories() ? this.categories() : this.categories().slice(0, 6)
  );
  readonly topCategoryAmount = computed(() => this.categories()[0]?.amount ?? 0);

  readonly budgets = computed(() => {
    const scope = this.scope();
    return this.insights
      .budgetSummaries()
      .filter((item) => scope === 'all' || item.budget.scope === scope)
      .slice(0, 6);
  });
  readonly budgetCount = computed(() => this.insights.budgetSummaries().length);
  readonly budgetsOver = computed(() => this.insights.budgetSummaries().filter((b) => b.status === 'over').length);
  readonly budgetsWarn = computed(() => this.insights.budgetSummaries().filter((b) => b.status === 'warning').length);

  readonly upcoming = computed(() => this.insights.upcoming(31).slice(0, 6));

  readonly recent = computed(() => {
    const scope = this.scope();
    const today = todayLocalDate();
    return sortNewestFirst(
      this.appState
        .transactions()
        .filter((tx) => (scope === 'all' || tx.scope === scope) && txLocalDate(tx) <= today)
    ).slice(0, 8);
  });

  readonly trend = computed(() => this.insights.spendTrend(this.range(), this.ui.previousPeriod(), this.scope()));
  readonly trendHasData = computed(() => this.trend().some((p) => p.daily > 0 || (p.previousCumulative ?? 0) > 0));

  readonly memberName = (id: string): string =>
    this.household()?.members.find((m) => m.userId === id)?.displayName ?? '';

  constructor() {
    void this.appState.ensureRecurringUpToDate();

    effect(() => {
      const points = this.trend();
      if (!this.chart) {
        return;
      }
      const styles = getComputedStyle(document.documentElement);
      const accent = styles.getPropertyValue('--accent').trim() || '#2563eb';
      const muted = styles.getPropertyValue('--text-3').trim() || '#94a3b8';
      this.chart.data.labels = points.map((p) => shortDate(p.date));
      this.chart.data.datasets[0].data = points.map((p) => (Number.isNaN(p.cumulative) ? null : p.cumulative)) as number[];
      this.chart.data.datasets[0].borderColor = accent;
      this.chart.data.datasets[0].backgroundColor = this.withAlpha(accent, 0.12);
      this.chart.data.datasets[1].data = points.map((p) => p.previousCumulative ?? null) as number[];
      this.chart.data.datasets[1].borderColor = muted;
      this.chart.update('none');
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.trendCanvas?.nativeElement;
    if (!canvas) {
      return;
    }
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#2563eb';
    const muted = styles.getPropertyValue('--text-3').trim() || '#94a3b8';
    const grid = styles.getPropertyValue('--border').trim() || '#e2e8f0';
    const text = styles.getPropertyValue('--text-3').trim() || '#64748b';
    const format = (value: number) => this.currency.format(value, { decimals: 'none' });

    this.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'This period',
            data: [],
            borderColor: accent,
            backgroundColor: this.withAlpha(accent, 0.12),
            fill: true,
            tension: 0.3,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHitRadius: 12,
            spanGaps: false
          },
          {
            label: 'Previous period',
            data: [],
            borderColor: muted,
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0,
            pointHitRadius: 12,
            fill: false,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 350 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            padding: 10,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: (item) => `${item.dataset.label}: ${format(Number(item.raw ?? 0))}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: text, maxTicksLimit: 6, font: { size: 11 } },
            border: { display: false }
          },
          y: {
            grid: { color: grid },
            border: { display: false },
            ticks: { color: text, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => format(Number(v)) },
            beginAtZero: true
          }
        }
      }
    });
    // Push the current data in now that the chart exists.
    this.chart.data.labels = this.trend().map((p) => shortDate(p.date));
    this.chart.data.datasets[0].data = this.trend().map((p) => (Number.isNaN(p.cumulative) ? null : p.cumulative)) as number[];
    this.chart.data.datasets[1].data = this.trend().map((p) => p.previousCumulative ?? null) as number[];
    this.chart.update('none');
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  setScope(scope: ScopeFilter): void {
    this.ui.setScopeFilter(scope);
  }

  onCustomStart(event: Event): void {
    this.ui.setCustomRange((event.target as HTMLInputElement).value, this.ui.customEnd());
  }

  onCustomEnd(event: Event): void {
    this.ui.setCustomRange(this.ui.customStart(), (event.target as HTMLInputElement).value);
  }

  openCategory(categoryId: string): void {
    const range = this.range();
    void this.router.navigate(['/transactions'], {
      queryParams: { category: categoryId, from: range.start, to: range.end, scope: this.scope() === 'all' ? null : this.scope() }
    });
  }

  openBudget(budgetId: string): void {
    void this.router.navigate(['/budgets'], { queryParams: { focus: budgetId } });
  }

  openTransaction(tx: Transaction): void {
    void this.router.navigate(['/transactions'], { queryParams: { edit: tx.id } });
  }

  addExpense(): void {
    this.ui.openQuickAdd({ type: 'expense' });
  }

  addIncome(): void {
    this.ui.openQuickAdd({ type: 'income' });
  }

  dueLabel(daysUntil: number, dueDate: string): string {
    if (daysUntil === 0) {
      return 'Today';
    }
    if (daysUntil === 1) {
      return 'Tomorrow';
    }
    return `${shortDate(dueDate)} · in ${daysUntil} days`;
  }

  private withAlpha(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) {
      return `rgba(37,99,235,${alpha})`;
    }
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
