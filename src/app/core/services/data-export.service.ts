import { Injectable, inject } from '@angular/core';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';

export interface ExportPayloadV1 {
  exportVersion: 1;
  exportedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    incomeMonthly: number;
    householdId: string;
  } | null;
  household: unknown;
  transactions: unknown[];
  categories: unknown[];
  budgets: unknown[];
  savings: unknown[];
  investments: unknown[];
  recurringTemplates: unknown[];
  additionalIncome: unknown[];
}

// Gathers everything the user is authorized to see in-memory (whatever
// AppStateService is currently watching) and downloads it as JSON. Versioned
// so future schema changes are detectable by readers.
@Injectable({ providedIn: 'root' })
export class DataExportService {
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);

  build(): ExportPayloadV1 {
    const user = this.auth.getActiveUser();
    const household = user ? this.appState.householdById(user.householdId) : undefined;
    return {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            incomeMonthly: user.incomeMonthly,
            householdId: user.householdId
          }
        : null,
      household: household ?? null,
      transactions: this.appState.transactions(),
      categories: this.appState.categories(),
      budgets: this.appState.budgets(),
      savings: this.appState.savingsGoals(),
      investments: this.appState.investments(),
      recurringTemplates: this.appState.recurringTemplates(),
      additionalIncome: this.appState.additionalIncome()
    };
  }

  download(): void {
    const payload = this.build();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = payload.exportedAt.replace(/[:.]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `twocents-export-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
