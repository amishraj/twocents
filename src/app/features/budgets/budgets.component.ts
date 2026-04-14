import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../shared/toast/toast.service';
import { CategoryModalComponent } from '../../shared/category-modal/category-modal.component';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { Scope } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CategoryModalComponent, ConfirmModalComponent],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss'
})
export class BudgetsComponent {
  private readonly fb = inject(FormBuilder);
  public appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  showCategoryModal = signal(false);
  showRenameCategoryModal = signal(false);
  renameCategoryId = signal<string | null>(null);
  editingBudgetId = signal<string | null>(null);
  confirmDeleteBudgetId = signal<string | null>(null);

  categories = computed(() => this.appState.categories());
  activeUser = computed(() => this.auth.getActiveUser());
  hasHousehold = computed(() => Boolean(this.activeUser()?.householdId?.trim()));
  householdName = computed(() => {
    const user = this.activeUser();
    if (!user) {
      return 'Household';
    }

    return this.appState.householdById(user.householdId)?.name ?? 'Household';
  });

  budgetSummaries = computed(() => {
    const now = new Date();
    return this.appState.budgets().map((budget) => {
      const start = new Date(now);
      if (budget.period === 'weekly') {
        start.setDate(now.getDate() - 6);
      } else {
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
      }

      const spent = this.appState
        .transactions()
        .filter((transaction) => {
          const txDate = new Date(transaction.date);
          return (
            transaction.categoryId === budget.categoryId &&
            transaction.scope === budget.scope &&
            txDate >= start
          );
        })
        .reduce((sum, transaction) => sum + transaction.amount, 0);

      const limit = budget.limit;
      const remaining = Math.max(limit - spent, 0);
      const percent = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;

      return {
        budget,
        spent,
        remaining,
        percent,
        category: this.appState.categoryById(budget.categoryId)
      };
    });
  });

  sharedBudgetSummaries = computed(() =>
    this.budgetSummaries().filter((summary) => summary.budget.scope === 'shared')
  );

  personalBudgetSummaries = computed(() =>
    this.budgetSummaries().filter((summary) => summary.budget.scope === 'personal')
  );

  showBudgetForm = false;

  budgetForm = this.fb.group({
    categoryId: ['', Validators.required],
    limit: [null as number | null, [Validators.required, Validators.min(0.01)]],
    period: ['monthly', Validators.required],
    scope: ['shared', Validators.required]
  });

  editBudgetForm = this.fb.group({
    categoryId: ['', Validators.required],
    limit: [null as number | null, [Validators.required, Validators.min(0.01)]],
    period: ['monthly', Validators.required],
    scope: ['shared', Validators.required]
  });

  renameCategoryForm = this.fb.group({
    name: ['', Validators.required]
  });

  constructor() {
    if (this.categories().length) {
      this.budgetForm.patchValue({ categoryId: this.categories()[0].id });
    }
  }

  toggleBudgetForm(): void {
    this.showBudgetForm = !this.showBudgetForm;
  }

  onBudgetCategorySelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '__new__') {
      this.showCategoryModal.set(true);
      this.budgetForm.patchValue({ categoryId: '' });
    }
  }

  onCategoryCreated(id: string): void {
    this.showCategoryModal.set(false);
    if (this.editingBudgetId()) {
      this.editBudgetForm.patchValue({ categoryId: id });
      return;
    }

    this.budgetForm.patchValue({ categoryId: id });
  }

  closeCategoryModal(): void {
    this.showCategoryModal.set(false);
    if (this.editingBudgetId()) {
      if (!this.editBudgetForm.value.categoryId) {
        this.editBudgetForm.patchValue({ categoryId: this.categories()[0]?.id ?? '' });
      }
      return;
    }

    if (!this.budgetForm.value.categoryId) {
      this.budgetForm.patchValue({ categoryId: this.categories()[0]?.id ?? '' });
    }
  }

  openRenameCategoryForCreate(): void {
    const categoryId = this.budgetForm.value.categoryId ?? '';
    this.openRenameCategory(categoryId);
  }

  openRenameCategoryForEdit(): void {
    const categoryId = this.editBudgetForm.value.categoryId ?? '';
    this.openRenameCategory(categoryId);
  }

  private openRenameCategory(categoryId: string): void {
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

    const id = this.renameCategoryId();
    if (!id) {
      return;
    }

    const value = (this.renameCategoryForm.value.name ?? '').trim();
    if (!value) {
      this.toast.warning('Category name cannot be empty.');
      return;
    }

    const duplicate = this.categories().some(
      (category) => category.id !== id && category.name.trim().toLowerCase() === value.toLowerCase()
    );
    if (duplicate) {
      this.toast.warning('A category with this name already exists.');
      return;
    }

    const next = this.categories().map((category) =>
      category.id === id
        ? {
            ...category,
            name: value
          }
        : category
    );

    this.appState.updateCategories(next);
    this.closeRenameCategoryModal();
    this.toast.success('Category renamed.');
  }

  startEditBudget(budgetId: string): void {
    const budget = this.appState.budgets().find((item) => item.id === budgetId);
    if (!budget) {
      return;
    }

    this.editingBudgetId.set(budgetId);
    this.editBudgetForm.patchValue({
      categoryId: budget.categoryId,
      limit: budget.limit,
      period: budget.period,
      scope: budget.scope
    });
  }

  cancelEditBudget(): void {
    this.editingBudgetId.set(null);
  }

  onEditCategorySelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '__new__') {
      this.showCategoryModal.set(true);
      this.editBudgetForm.patchValue({ categoryId: '' });
    }
  }

  setEditLimit(value: string): void {
    const parsed = Number(value);
    this.editBudgetForm.patchValue({
      limit: Number.isFinite(parsed) ? Math.max(parsed, 0.01) : 0.01
    });
  }

  saveBudgetEdit(budgetId: string): void {
    if (this.editBudgetForm.invalid) {
      this.editBudgetForm.markAllAsTouched();
      this.toast.warning('Please fill in all required fields.');
      return;
    }

    const value = this.editBudgetForm.getRawValue();
    const selectedScope = (value.scope ?? 'shared') as Scope;
    const resolvedScope = !this.hasHousehold() && selectedScope === 'shared' ? 'personal' : selectedScope;
    if (selectedScope === 'shared' && resolvedScope === 'personal') {
      this.toast.info('Shared budgets are locked until you join or create a household. Saved as personal.');
    }

    const nextBudgets = this.appState.budgets().map((budget) =>
      budget.id === budgetId
        ? {
            ...budget,
            categoryId: value.categoryId ?? budget.categoryId,
            limit: Number(value.limit),
            period: (value.period ?? 'monthly') as 'weekly' | 'monthly',
            scope: resolvedScope
          }
        : budget
    );

    this.appState.updateBudgets(nextBudgets);
    this.editingBudgetId.set(null);
    this.toast.success('Budget updated.');
  }

  budgetUsageColor(percent: number): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const hue = Math.round(120 - (clamped / 100) * 120);
    return `hsl(${hue} 78% 46%)`;
  }


  addBudget(): void {
    if (this.budgetForm.invalid) {
      this.budgetForm.markAllAsTouched();
      if (!this.budgetForm.value.categoryId) {
        this.toast.warning('Please select or create a category first.');
      } else {
        this.toast.warning('Please fill in all required fields.');
      }
      return;
    }

    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return;
    }

    const value = this.budgetForm.getRawValue();
    const selectedScope = (value.scope ?? 'shared') as Scope;
    const resolvedScope = !this.hasHousehold() && selectedScope === 'shared' ? 'personal' : selectedScope;
    if (selectedScope === 'shared' && resolvedScope === 'personal') {
      this.toast.info('Shared budgets are locked until you join or create a household. Saved as personal.');
    }

    this.appState.addBudget({
      id: createId(),
      categoryId: value.categoryId ?? '',
      limit: Number(value.limit),
      period: (value.period ?? 'monthly') as 'weekly' | 'monthly',
      scope: resolvedScope,
      ownerId: activeUser.id,
      householdId: activeUser.householdId
    });

    this.toast.success('Budget created.');

    this.budgetForm.reset({
      categoryId: this.categories()[0]?.id ?? '',
      limit: null,
      period: 'monthly',
      scope: this.hasHousehold() ? 'shared' : 'personal'
    });

    this.showBudgetForm = false;
  }

  requestRemoveBudget(budgetId: string): void {
    this.confirmDeleteBudgetId.set(budgetId);
  }

  cancelRemoveBudget(): void {
    this.confirmDeleteBudgetId.set(null);
  }

  removeBudget(): void {
    const budgetId = this.confirmDeleteBudgetId();
    if (!budgetId) {
      return;
    }

    this.appState.removeBudget(budgetId);
    this.confirmDeleteBudgetId.set(null);
    this.toast.success('Budget removed.');
  }
}
