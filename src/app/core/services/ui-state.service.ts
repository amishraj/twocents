import { Injectable, signal } from '@angular/core';

export type DashboardRange = 'week' | 'month';

@Injectable({ providedIn: 'root' })
export class UiStateService {
  readonly quickAddOpen = signal(false);
  readonly dashboardRange = signal<DashboardRange>('week');

  openQuickAdd(): void {
    this.quickAddOpen.set(true);
  }

  closeQuickAdd(): void {
    this.quickAddOpen.set(false);
  }

  setRange(range: DashboardRange): void {
    this.dashboardRange.set(range);
  }
}
