import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Scope } from '../../core/models/app.models';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../shared/toast/toast.service';
import { CategoryModalComponent } from '../../shared/category-modal/category-modal.component';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { TransactionRowComponent } from '../../shared/transaction-row/transaction-row.component';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CategoryModalComponent, ConfirmModalComponent, TransactionRowComponent],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss'
})
export class TransactionsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  public appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  editingId = signal<string | null>(null);
  confirmDeleteId = signal<string | null>(null);
  showCategoryModal = signal(false);
  showRenameCategoryModal = signal(false);
  renameCategoryId = signal<string | null>(null);
  categoryFilterOpen = signal(false);
  categoryFilter = signal<string | null>(null);
  numericCompare = signal<'lt' | 'eq' | 'gt'>('eq');

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

  renameCategoryForm = this.fb.group({
    name: ['', Validators.required]
  });

  private readonly filterValue = toSignal(this.filterForm.valueChanges, {
    initialValue: this.filterForm.getRawValue()
  });

  hasHousehold = computed(() => Boolean(this.auth.getActiveUser()?.householdId?.trim()));

  setNumericCompare(mode: 'lt' | 'eq' | 'gt'): void {
    this.numericCompare.set(mode);
  }

  isNumericSearch = computed(() => {
    const query = (this.filterValue().query ?? '').trim();
    return query.length > 0 && !isNaN(Number(query));
  });

  filteredTransactions = computed(() => {
    const filter = this.filterValue();
    const query = (filter.query ?? '').trim().toLowerCase();
    const scope = filter.scope ?? 'all';
    const catFilter = this.categoryFilter();
    const compare = this.numericCompare();

    const numQuery = Number(query);
    const isNumericQuery = query.length > 0 && !isNaN(numQuery);

    return this.appState
      .transactions()
      .filter((transaction) =>
        scope === 'all' ? true : transaction.scope === scope
      )
      .filter((transaction) =>
        catFilter ? transaction.categoryId === catFilter : true
      )
      .filter((transaction) => {
        if (isNumericQuery) {
          if (compare === 'lt') return transaction.amount <= numQuery;
          if (compare === 'gt') return transaction.amount >= numQuery;
          return transaction.amount === numQuery || transaction.amount.toString().includes(query);
        }
        return transaction.title.toLowerCase().includes(query);
      })
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
    this.closeRenameCategoryModal();
    this.editingId.set(null);
  }

  onEditCategorySelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '__new__') {
      this.showCategoryModal.set(true);
      this.editForm.patchValue({ categoryId: '' });
    }
  }

  onCategoryCreated(id: string): void {
    this.showCategoryModal.set(false);
    this.editForm.patchValue({ categoryId: id });
  }

  closeCategoryModal(): void {
    this.showCategoryModal.set(false);
  }

  openRenameCategory(): void {
    const categoryId = this.editForm.value.categoryId ?? '';
    if (!categoryId || categoryId === '__new__') {
      this.toast.info('Select a category first, then rename it.');
      return;
    }

    const category = this.appState.categoryById(categoryId);
    if (!category) {
      this.toast.warning('Could not find this category right now.');
      return;
    }

    this.renameCategoryId.set(categoryId);
    this.renameCategoryForm.patchValue({ name: category.name });
    this.showRenameCategoryModal.set(true);
  }

  closeRenameCategoryModal(): void {
    this.showRenameCategoryModal.set(false);
    this.renameCategoryId.set(null);
    this.renameCategoryForm.reset({ name: '' });
  }

  saveCategoryRename(): void {
    if (this.renameCategoryForm.invalid) {
      this.renameCategoryForm.markAllAsTouched();
      return;
    }

    const categoryId = this.renameCategoryId();
    if (!categoryId) {
      return;
    }

    const nextName = (this.renameCategoryForm.value.name ?? '').trim();
    if (!nextName) {
      this.toast.warning('Category name cannot be empty.');
      return;
    }

    const duplicate = this.appState
      .categories()
      .some((category) => category.id !== categoryId && category.name.trim().toLowerCase() === nextName.toLowerCase());
    if (duplicate) {
      this.toast.warning('A category with this name already exists.');
      return;
    }

    const nextCategories = this.appState.categories().map((category) =>
      category.id === categoryId
        ? {
            ...category,
            name: nextName
          }
        : category
    );

    this.appState.updateCategories(nextCategories);
    this.closeRenameCategoryModal();
    this.toast.success('Category renamed.');
  }

  toggleCategoryFilter(): void {
    this.categoryFilterOpen.set(!this.categoryFilterOpen());
  }

  setCategoryFilter(categoryId: string | null): void {
    this.categoryFilter.set(categoryId);
    this.categoryFilterOpen.set(false);
  }

  saveEdit(): void {
    if (this.editForm.invalid || !this.editingId()) {
      this.editForm.markAllAsTouched();
      this.toast.warning('Please fill in all required fields.');
      return;
    }

    const value = this.editForm.getRawValue();
    const selectedScope = (value.scope ?? 'shared') as Scope;
    const resolvedScope = !this.hasHousehold() && selectedScope === 'shared' ? 'personal' : selectedScope;
    if (selectedScope === 'shared' && resolvedScope === 'personal') {
      this.toast.info('Shared transactions are locked until you join or create a household. Saved as personal.');
    }

    const next = this.appState.transactions().map((transaction) => {
      if (transaction.id !== this.editingId()) {
        return transaction;
      }

      return {
        ...transaction,
        title: value.title ?? transaction.title,
        amount: Number(value.amount),
        categoryId: value.categoryId ?? transaction.categoryId,
          scope: resolvedScope,
          date: new Date(`${value.date ?? transaction.date.slice(0, 10)}T12:00:00`).toISOString()
        };
    });

    this.appState.updateTransactions(next);
    this.editingId.set(null);
    this.toast.success('Transaction updated.');
  }

  requestDelete(transactionId: string): void {
    this.confirmDeleteId.set(transactionId);
  }

  cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  confirmDelete(): void {
    const transactionId = this.confirmDeleteId();
    if (!transactionId) {
      return;
    }

    this.appState.removeTransaction(transactionId);
    this.confirmDeleteId.set(null);
    this.toast.success('Transaction deleted.');
    if (this.editingId() === transactionId) {
      this.cancelEdit();
    }
  }

}
