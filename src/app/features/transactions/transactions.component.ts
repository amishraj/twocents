import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Scope } from '../../core/models/app.models';
import { AppStateService } from '../../core/services/app-state.service';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss'
})
export class TransactionsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  public appState = inject(AppStateService);
  editingId = signal<string | null>(null);

  filterForm = this.fb.group({
    query: [''],
    scope: ['all']
  });

  editForm = this.fb.group({
    title: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    categoryId: ['', Validators.required],
    scope: ['shared', Validators.required],
    date: ['', Validators.required]
  });

  private readonly filterValue = toSignal(this.filterForm.valueChanges, {
    initialValue: this.filterForm.getRawValue()
  });

  filteredTransactions = computed(() => {
    const filter = this.filterValue();
    const query = (filter.query ?? '').toLowerCase();
    const scope = filter.scope ?? 'all';
    return this.appState
      .transactions()
      .filter((transaction) =>
        scope === 'all' ? true : transaction.scope === scope
      )
      .filter((transaction) => transaction.title.toLowerCase().includes(query));
  });

  constructor() {
    void this.appState.ensureRecurringUpToDate();
    const requested = this.route.snapshot.queryParamMap.get('edit');
    if (requested) {
      const transaction = this.appState.transactions().find((item) => item.id === requested);
      if (transaction) {
        this.startEdit(transaction.id);
      }
    }
  }

  startEdit(transactionId: string): void {
    const transaction = this.appState.transactions().find((item) => item.id === transactionId);
    if (!transaction) {
      return;
    }

    this.editingId.set(transactionId);
    this.editForm.patchValue({
      title: transaction.title,
      amount: transaction.amount,
      categoryId: transaction.categoryId,
      scope: transaction.scope,
      date: transaction.date.slice(0, 10)
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  saveEdit(): void {
    if (this.editForm.invalid || !this.editingId()) {
      this.editForm.markAllAsTouched();
      return;
    }

    const value = this.editForm.getRawValue();
    const next = this.appState.transactions().map((transaction) => {
      if (transaction.id !== this.editingId()) {
        return transaction;
      }

      return {
        ...transaction,
        title: value.title ?? transaction.title,
        amount: Number(value.amount),
        categoryId: value.categoryId ?? transaction.categoryId,
        scope: (value.scope ?? transaction.scope) as Scope,
        date: new Date(`${value.date ?? transaction.date.slice(0, 10)}T12:00:00`).toISOString()
      };
    });

    this.appState.updateTransactions(next);
    this.editingId.set(null);
  }

  deleteTransaction(transactionId: string): void {
    const transaction = this.appState.transactions().find((item) => item.id === transactionId);
    if (!transaction) {
      return;
    }

    const confirmed = window.confirm(`Delete transaction \"${transaction.title}\"?`);
    if (!confirmed) {
      return;
    }

    this.appState.removeTransaction(transactionId);
    if (this.editingId() === transactionId) {
      this.cancelEdit();
    }
  }

}
