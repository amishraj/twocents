import { Pipe, PipeTransform, inject } from '@angular/core';
import { CurrencyService } from '../services/currency.service';

// {{ 1234.5 | money }}            → $1,234.50
// {{ 1234 | money }}              → $1,234
// {{ 1234.5 | money:'none' }}     → $1,235   (summary tiles)
// {{ 12 | money:'always' }}       → $12.00   (ledger rows)
// {{ 12 | money:'auto':true }}    → +$12     (signed)
// Impure so a currency preference change re-renders every amount.
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly currency = inject(CurrencyService);

  transform(value: number | null | undefined, decimals: 'auto' | 'none' | 'always' = 'auto', signed = false): string {
    return this.currency.format(value ?? 0, { decimals, signed });
  }
}
