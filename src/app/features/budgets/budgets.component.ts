import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../shared/toast/toast.service';
import { CategoryModalComponent } from '../../shared/category-modal/category-modal.component';
import { Scope } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CategoryModalComponent],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss'
})
export class BudgetsComponent {
  private readonly fb = inject(FormBuilder);
  public appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  showCategoryModal = signal(false);

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
    this.budgetForm.patchValue({ categoryId: id });
  }

  closeCategoryModal(): void {
    this.showCategoryModal.set(false);
    if (!this.budgetForm.value.categoryId) {
      this.budgetForm.patchValue({ categoryId: this.categories()[0]?.id ?? '' });
    }
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

  removeBudget(budgetId: string): void {
    this.appState.removeBudget(budgetId);
    this.toast.success('Budget removed.');
  }
}
