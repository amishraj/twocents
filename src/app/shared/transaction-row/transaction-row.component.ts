import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Transaction } from '../../core/models/app.models';
import { AppStateService } from '../../core/services/app-state.service';

@Component({
  selector: 'app-tx-row',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './transaction-row.component.html',
  styleUrl: './transaction-row.component.scss'
})
export class TransactionRowComponent {
  @Input({ required: true }) transaction!: Transaction;
  @Input() showCategory = true;
  @Input() showScope = true;
  @Input() showPaidBy = false;
  @Input() showEditButton = false;
  @Input() showDeleteButton = false;
  @Input() showAmount = true;
  @Input() dateLeft = false;
  @Input() paidByName = '';
  @Input() categoryName = '';
  @Input() editAsLink = false;
  @Output() edit = new EventEmitter<string>();
  @Output() delete = new EventEmitter<string>();

  private readonly appState = inject(AppStateService);

  readonly todayStr = new Date().toISOString().split('T')[0];

  isFuture(): boolean {
    return this.transaction.date.substring(0, 10) > this.todayStr;
  }

  isToday(): boolean {
    return this.transaction.date.substring(0, 10) === this.todayStr;
  }

  getCategoryName(): string {
    if (this.categoryName) return this.categoryName;
    return this.appState.categoryById(this.transaction.categoryId)?.name ?? 'Category';
  }

  onEdit(): void {
    this.edit.emit(this.transaction.id);
  }

  onDelete(): void {
    this.delete.emit(this.transaction.id);
  }
}
