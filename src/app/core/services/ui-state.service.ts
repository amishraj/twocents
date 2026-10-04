import { Injectable, computed, inject, signal } from '@angular/core';
import { todayLocalDate } from '../utils/dates';
import {
  DateRange,
  PeriodMode,
  addDays,
  addMonths,
  monthRange,
  previousRange,
  rangeLabel,
  weekRange
} from '../utils/periods';
import { ScopeFilter } from '../utils/transactions';
import { AuthService } from './auth.service';

export interface QuickAddPreset {
  type?: 'expense' | 'income';
  categoryId?: string;
  date?: string;
}

// Cross-page UI state: which period the overview is looking at, which scope
// lens is active, and whether the quick-add sheet is open. Kept in a service so
// navigating between pages doesn't reset the user's context.
@Injectable({ providedIn: 'root' })
export class UiStateService {
  private readonly auth = inject(AuthService);

  readonly quickAddOpen = signal(false);
  readonly quickAddPreset = signal<QuickAddPreset | null>(null);

  readonly periodMode = signal<PeriodMode>('month');
  // The date the week/month period is anchored on. Moving back/forward shifts it.
  readonly anchorDate = signal<string>(todayLocalDate());
  readonly customStart = signal<string>('');
  readonly customEnd = signal<string>('');
  readonly scopeFilter = signal<ScopeFilter>('all');

  readonly weekStartsOn = computed<0 | 1>(() => this.auth.getActiveUser()?.preferences.weekStartsOn ?? 1);

  readonly range = computed<DateRange>(() => {
    const mode = this.periodMode();
    const anchor = this.anchorDate();
    if (mode === 'custom') {
      const start = this.customStart();
      const end = this.customEnd();
      if (start && end) {
        return start <= end ? { start, end } : { start: end, end: start };
      }
      return monthRange(anchor);
    }
    if (mode === 'week') {
      return weekRange(anchor, this.weekStartsOn());
    }
    return monthRange(anchor);
  });

  readonly previousPeriod = computed<DateRange>(() => previousRange(this.range(), this.periodMode()));
  readonly rangeLabel = computed(() => rangeLabel(this.range()));
  readonly isCurrentPeriod = computed(() => {
    const today = todayLocalDate();
    const r = this.range();
    return today >= r.start && today <= r.end;
  });

  openQuickAdd(preset: QuickAddPreset | null = null): void {
    this.quickAddPreset.set(preset);
    this.quickAddOpen.set(true);
  }

  closeQuickAdd(): void {
    this.quickAddOpen.set(false);
    this.quickAddPreset.set(null);
  }

  setPeriodMode(mode: PeriodMode): void {
    if (mode === 'custom' && (!this.customStart() || !this.customEnd())) {
      const current = this.range();
      this.customStart.set(current.start);
      this.customEnd.set(current.end);
    }
    this.periodMode.set(mode);
  }

  setCustomRange(start: string, end: string): void {
    if (start) {
      this.customStart.set(start);
    }
    if (end) {
      this.customEnd.set(end);
    }
    this.periodMode.set('custom');
  }

  shiftPeriod(delta: 1 | -1): void {
    const mode = this.periodMode();
    if (mode === 'month') {
      this.anchorDate.set(addMonths(this.anchorDate(), delta));
      return;
    }
    if (mode === 'week') {
      this.anchorDate.set(addDays(this.anchorDate(), 7 * delta));
      return;
    }
    const current = this.range();
    const shifted = delta < 0 ? previousRange(current) : nextRange(current);
    this.customStart.set(shifted.start);
    this.customEnd.set(shifted.end);
  }

  jumpToToday(): void {
    this.anchorDate.set(todayLocalDate());
    if (this.periodMode() === 'custom') {
      this.periodMode.set('month');
    }
  }

  setScopeFilter(filter: ScopeFilter): void {
    this.scopeFilter.set(filter);
  }
}

const nextRange = (range: DateRange): DateRange => {
  const length = Math.max(1, Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1);
  const start = addDays(range.end, 1);
  return { start, end: addDays(start, length - 1) };
};
