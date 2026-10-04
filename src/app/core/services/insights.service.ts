import { Injectable, computed, inject } from '@angular/core';
import { Budget, BudgetCategory, RecurringTemplate, Transaction } from '../models/app.models';
import { formatLocal, parseLocalDateParts, resolveDayOfMonth, todayLocalDate } from '../utils/dates';
import {
  DateRange,
  addMonths,
  daysElapsed,
  daysInRange,
  daysRemaining,
  eachDay,
  monthRange,
  rangeLabel,
  weekRange
} from '../utils/periods';
import {
  ScopeFilter,
  isExpense,
  isIncome,
  matchesScope,
  sortNewestFirst,
  sumAmounts,
  txInRange,
  txLocalDate
} from '../utils/transactions';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';

export type BudgetStatus = 'ok' | 'warning' | 'over';

export interface BudgetSummary {
  budget: Budget;
  category: BudgetCategory | undefined;
  ownerName: string;
  range: DateRange;
  rangeLabel: string;
  spent: number;
  remaining: number;
  // 0–100 for display; `rawPercent` can exceed 100.
  percent: number;
  rawPercent: number;
  status: BudgetStatus;
  daysLeft: number;
  // What you can spend per remaining day and still land on the limit.
  safePerDay: number;
  // Spending pace: expected spend-to-date if you spent evenly through the period.
  expectedToDate: number;
  transactions: Transaction[];
}

export interface CategoryTotal {
  category: BudgetCategory | undefined;
  categoryId: string;
  amount: number;
  count: number;
  share: number; // 0–1 of total spend in the range
}

export interface PeriodSummary {
  range: DateRange;
  spent: number;
  received: number;
  net: number;
  count: number;
  // Previous period of equal length, for deltas.
  previousSpent: number;
  previousReceived: number;
  // Average *everyday* spend per elapsed day (recurring bills excluded so one
  // rent payment doesn't inflate it), and a projection to the end of the range
  // when the range is current: what's already spent plus that pace for the
  // remaining days.
  dailyAverage: number;
  projectedSpend: number | null;
}

export interface UpcomingItem {
  template: RecurringTemplate;
  dueDate: string;
  category: BudgetCategory | undefined;
  daysUntil: number;
}

export interface TrendPoint {
  date: string;
  cumulative: number;
  previousCumulative: number | null;
  daily: number;
}

// One place where every number in the app is computed. The dashboard, budgets
// page and household page all read from here, so they can never disagree.
@Injectable({ providedIn: 'root' })
export class InsightsService {
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);

  private readonly weekStartsOn = computed<0 | 1>(() => this.auth.getActiveUser()?.preferences.weekStartsOn ?? 1);

  readonly expenses = computed(() => this.appState.transactions().filter(isExpense));
  readonly incomes = computed(() => this.appState.transactions().filter(isIncome));

  // ── Budgets ─────────────────────────────────────────────────────────────
  readonly budgetSummaries = computed<BudgetSummary[]>(() => {
    const today = todayLocalDate();
    const expenses = this.expenses();
    return this.appState
      .budgets()
      .map((budget) => this.summarizeBudget(budget, expenses, today))
      .sort((a, b) => b.rawPercent - a.rawPercent);
  });

  budgetSummary(budgetId: string): BudgetSummary | undefined {
    return this.budgetSummaries().find((item) => item.budget.id === budgetId);
  }

  budgetRange(budget: Budget, today = todayLocalDate()): DateRange {
    return budget.period === 'weekly' ? weekRange(today, this.weekStartsOn()) : monthRange(today);
  }

  // Which expenses count against a budget: same category, same scope, and for
  // personal budgets only the owner's own spending.
  budgetTransactions(budget: Budget, expenses: Transaction[], range: DateRange): Transaction[] {
    return expenses.filter(
      (tx) =>
        tx.categoryId === budget.categoryId &&
        tx.scope === budget.scope &&
        (budget.scope === 'shared' || !budget.ownerId || tx.paidByUserId === budget.ownerId) &&
        txInRange(tx, range)
    );
  }

  private summarizeBudget(budget: Budget, expenses: Transaction[], today: string): BudgetSummary {
    const range = this.budgetRange(budget, today);
    const transactions = sortNewestFirst(this.budgetTransactions(budget, expenses, range));
    const spent = sumAmounts(transactions);
    const limit = budget.limit > 0 ? budget.limit : 0;
    const rawPercent = limit > 0 ? (spent / limit) * 100 : 0;
    const percent = Math.min(100, Math.round(rawPercent));
    const daysLeft = daysRemaining(range, today);
    const elapsed = daysElapsed(range, today);
    const total = daysInRange(range);
    const expectedToDate = limit * (elapsed / total);
    const remaining = Math.round((limit - spent) * 100) / 100;
    let status: BudgetStatus = 'ok';
    if (rawPercent >= 100) {
      status = 'over';
    } else if (rawPercent >= 85 || (elapsed > 0 && spent > expectedToDate * 1.25 && rawPercent >= 50)) {
      status = 'warning';
    }
    const owner = this.appState.userById(budget.ownerId);
    return {
      budget,
      category: this.appState.categoryById(budget.categoryId),
      ownerName: owner?.name ?? '',
      range,
      rangeLabel: rangeLabel(range),
      spent,
      remaining,
      percent,
      rawPercent,
      status,
      daysLeft,
      safePerDay: daysLeft > 0 && remaining > 0 ? Math.floor((remaining / daysLeft) * 100) / 100 : 0,
      expectedToDate,
      transactions
    };
  }

  // ── Period summaries ────────────────────────────────────────────────────
  transactionsIn(range: DateRange, scope: ScopeFilter = 'all'): Transaction[] {
    return this.appState.transactions().filter((tx) => matchesScope(tx, scope) && txInRange(tx, range));
  }

  periodSummary(range: DateRange, previous: DateRange, scope: ScopeFilter = 'all'): PeriodSummary {
    const current = this.transactionsIn(range, scope);
    const prior = this.transactionsIn(previous, scope);
    const spent = sumAmounts(current.filter(isExpense));
    const received = sumAmounts(current.filter(isIncome));
    const today = todayLocalDate();
    const elapsed = daysElapsed(range, today);
    const remaining = daysRemaining(range, today) - (today >= range.start && today <= range.end ? 1 : 0);
    const isCurrent = today >= range.start && today <= range.end;
    const variableSpent = sumAmounts(current.filter((tx) => isExpense(tx) && !tx.recurring));
    const dailyAverage = elapsed > 0 ? variableSpent / elapsed : 0;
    return {
      range,
      spent,
      received,
      net: Math.round((received - spent) * 100) / 100,
      count: current.length,
      previousSpent: sumAmounts(prior.filter(isExpense)),
      previousReceived: sumAmounts(prior.filter(isIncome)),
      dailyAverage,
      projectedSpend: isCurrent && elapsed >= 3 ? Math.round(spent + dailyAverage * Math.max(0, remaining)) : null
    };
  }

  categoryTotals(range: DateRange, scope: ScopeFilter = 'all'): CategoryTotal[] {
    const totals = new Map<string, { amount: number; count: number }>();
    for (const tx of this.transactionsIn(range, scope)) {
      if (!isExpense(tx)) {
        continue;
      }
      const entry = totals.get(tx.categoryId) ?? { amount: 0, count: 0 };
      entry.amount += tx.amount;
      entry.count += 1;
      totals.set(tx.categoryId, entry);
    }
    const grand = Array.from(totals.values()).reduce((sum, item) => sum + item.amount, 0);
    return Array.from(totals.entries())
      .map(([categoryId, entry]) => ({
        categoryId,
        category: this.appState.categoryById(categoryId),
        amount: Math.round(entry.amount * 100) / 100,
        count: entry.count,
        share: grand > 0 ? entry.amount / grand : 0
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  // Cumulative spend by day for the range, with the previous period aligned by
  // day index so the two lines can be compared on one chart.
  spendTrend(range: DateRange, previous: DateRange, scope: ScopeFilter = 'all'): TrendPoint[] {
    const current = this.transactionsIn(range, scope).filter(isExpense);
    const prior = this.transactionsIn(previous, scope).filter(isExpense);
    const byDay = new Map<string, number>();
    for (const tx of current) {
      const key = txLocalDate(tx);
      byDay.set(key, (byDay.get(key) ?? 0) + tx.amount);
    }
    const priorByDay = new Map<string, number>();
    for (const tx of prior) {
      const key = txLocalDate(tx);
      priorByDay.set(key, (priorByDay.get(key) ?? 0) + tx.amount);
    }
    const days = eachDay(range);
    const priorDays = eachDay(previous);
    const today = todayLocalDate();
    let cumulative = 0;
    let priorCumulative = 0;
    return days.map((date, index) => {
      const daily = byDay.get(date) ?? 0;
      const priorDate = priorDays[index];
      if (priorDate) {
        priorCumulative += priorByDay.get(priorDate) ?? 0;
      }
      cumulative += daily;
      return {
        date,
        daily,
        cumulative: date <= today ? Math.round(cumulative * 100) / 100 : NaN,
        previousCumulative: priorDate ? Math.round(priorCumulative * 100) / 100 : null
      };
    });
  }

  // ── Recurring ───────────────────────────────────────────────────────────
  // Next due date for a template on or after `from`.
  nextDueDate(template: RecurringTemplate, from = todayLocalDate()): string {
    const parts = parseLocalDateParts(from);
    if (!parts) {
      return from;
    }
    const thisMonthDay = resolveDayOfMonth(parts.year, parts.month, template.dayOfMonth);
    const candidate = `${parts.year}-${`${parts.month}`.padStart(2, '0')}-${`${thisMonthDay}`.padStart(2, '0')}`;
    if (candidate >= from) {
      return candidate;
    }
    const nextMonth = addMonths(from, 1);
    const next = parseLocalDateParts(nextMonth);
    if (!next) {
      return candidate;
    }
    const day = resolveDayOfMonth(next.year, next.month, template.dayOfMonth);
    return `${next.year}-${`${next.month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
  }

  upcoming(days = 14): UpcomingItem[] {
    const today = todayLocalDate();
    const horizon = formatLocal(new Date(Date.now() + days * 86_400_000));
    const existingKeys = new Set(
      this.appState.transactions().map((tx) => tx.recurringKey).filter((key): key is string => Boolean(key))
    );
    return this.appState
      .recurringTemplates()
      .filter((template) => template.active)
      .map((template) => {
        const dueDate = this.nextDueDate(template, today);
        return { template, dueDate };
      })
      .filter(({ template, dueDate }) => {
        if (dueDate > horizon) {
          return false;
        }
        const parts = parseLocalDateParts(dueDate);
        const key = parts ? `${template.id}_${parts.year}_${parts.month}` : '';
        // Already generated (e.g. the user logged it early) → not upcoming.
        return !existingKeys.has(key);
      })
      .map(({ template, dueDate }) => ({
        template,
        dueDate,
        category: this.appState.categoryById(template.categoryId),
        daysUntil: Math.max(0, Math.round((Date.parse(dueDate) - Date.parse(today)) / 86_400_000))
      }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  // Monthly commitments: sum of active recurring expense templates.
  readonly recurringMonthlyExpense = computed(() =>
    sumAmounts(
      this.appState
        .recurringTemplates()
        .filter((t) => t.active && t.type !== 'income')
        .map((t) => ({ amount: t.amount }) as Transaction)
    )
  );

  readonly recurringMonthlyIncome = computed(() =>
    sumAmounts(
      this.appState
        .recurringTemplates()
        .filter((t) => t.active && t.type === 'income')
        .map((t) => ({ amount: t.amount }) as Transaction)
    )
  );
}
