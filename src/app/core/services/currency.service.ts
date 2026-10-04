import { Injectable, computed, inject } from '@angular/core';
import { AppStateService } from './app-state.service';
import { AuthService } from './auth.service';

// Single source for "which currency are we displaying". The household's
// currency wins (shared ledger), then the user's preference, then USD.
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);

  readonly code = computed(() => {
    const user = this.auth.getActiveUser();
    const household = user ? this.appState.householdById(user.householdId) : undefined;
    return (household?.currency || user?.preferences.currency || 'USD').toUpperCase();
  });

  private readonly formatters = new Map<string, Intl.NumberFormat>();

  format(amount: number, options: { decimals?: 'auto' | 'none' | 'always'; signed?: boolean } = {}): string {
    const code = this.code();
    const decimals = options.decimals ?? 'auto';
    const safe = Number.isFinite(amount) ? amount : 0;
    const showCents = decimals === 'always' || (decimals === 'auto' && Math.abs(safe) < 10_000 && Math.round(safe) !== safe);
    const key = `${code}:${showCents ? 2 : 0}`;
    let fmt = this.formatters.get(key);
    if (!fmt) {
      try {
        fmt = new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: code,
          minimumFractionDigits: showCents ? 2 : 0,
          maximumFractionDigits: showCents ? 2 : 0
        });
      } catch {
        fmt = new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: showCents ? 2 : 0,
          maximumFractionDigits: showCents ? 2 : 0
        });
      }
      this.formatters.set(key, fmt);
    }
    const text = fmt.format(Math.abs(safe));
    if (safe < 0) {
      return `−${text}`;
    }
    return options.signed && safe > 0 ? `+${text}` : text;
  }

  private readonly symbols = new Map<string, string>();

  symbol(): string {
    const code = this.code();
    let symbol = this.symbols.get(code);
    if (!symbol) {
      try {
        const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).formatToParts(0);
        symbol = parts.find((p) => p.type === 'currency')?.value ?? '$';
      } catch {
        symbol = '$';
      }
      this.symbols.set(code, symbol);
    }
    return symbol;
  }
}
