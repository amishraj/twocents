import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { Transaction } from '../../core/models/app.models';
import { AppStateService } from '../../core/services/app-state.service';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { todayLocalDate } from '../../core/utils/dates';
import { shortDate } from '../../core/utils/periods';
import { isIncome, txLocalDate } from '../../core/utils/transactions';
import { IconComponent } from '../icon/icon.component';

// One ledger line. Used by every list in the app so transactions always look
// the same: category swatch, title, context line, signed amount.
@Component({
  selector: 'app-tx-row',
  standalone: true,
  imports: [MoneyPipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction-row.component.html',
  styleUrl: './transaction-row.component.scss'
})
export class TransactionRowComponent {
  @Input({ required: true }) transaction!: Transaction;
  @Input() showCategory = true;
  @Input() showScope = true;
  @Input() showDate = false;
  @Input() showPaidBy = false;
  @Input() paidByName = '';
  @Input() categoryName = '';
  @Input() clickable = false;
  @Output() selected = new EventEmitter<Transaction>();

  private readonly appState = inject(AppStateService);

  get localDate(): string {
    return txLocalDate(this.transaction);
  }

  get isFuture(): boolean {
    return this.localDate > todayLocalDate();
  }

  get isIncome(): boolean {
    return isIncome(this.transaction);
  }

  get category() {
    return this.appState.categoryById(this.transaction.categoryId);
  }

  get label(): string {
    return this.categoryName || this.category?.name || 'Uncategorized';
  }

  get color(): string {
    return this.isIncome ? 'var(--pos)' : this.category?.color ?? 'var(--text-3)';
  }

  get initial(): string {
    return (this.label.trim().charAt(0) || '?').toUpperCase();
  }

  get dateLabel(): string {
    const date = this.localDate;
    const year = date.slice(0, 4);
    return shortDate(date, year !== todayLocalDate().slice(0, 4));
  }

  get meta(): string[] {
    const parts: string[] = [];
    if (this.showDate) {
      parts.push(this.dateLabel);
    }
    if (this.showCategory) {
      parts.push(this.label);
    }
    if (this.showPaidBy && this.paidByName) {
      parts.push(`Paid by ${this.paidByName}`);
    }
    if (this.showScope) {
      parts.push(this.transaction.scope === 'shared' ? 'Shared' : 'Personal');
    }
    return parts;
  }

  onClick(): void {
    if (this.clickable) {
      this.selected.emit(this.transaction);
    }
  }
}
