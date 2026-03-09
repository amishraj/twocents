import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { Scope } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss'
})
export class BudgetsComponent {
  private readonly fb = inject(FormBuilder);
  public appState = inject(AppStateService);
  private readonly auth = inject(AuthService);

  categories = computed(() => this.appState.categories());
  activeUser = computed(() => this.auth.getActiveUser());
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
  showCategoryForm = false;

  budgetForm = this.fb.group({
    categoryId: ['', Validators.required],
    limit: [0, [Validators.required, Validators.min(0)]],
    period: ['monthly', Validators.required],
    scope: ['shared', Validators.required]
  });

  categoryForm = this.fb.group({
    name: ['', Validators.required],
    color: ['#0ea5e9', Validators.required],
    icon: ['tag', Validators.required],
    defaultScope: ['shared', Validators.required]
  });

  constructor() {
    if (this.categories().length) {
      this.budgetForm.patchValue({ categoryId: this.categories()[0].id });
    }
  }

  toggleBudgetForm(): void {
    this.showBudgetForm = !this.showBudgetForm;
  }

  toggleCategoryForm(): void {
    this.showCategoryForm = !this.showCategoryForm;
  }

  addBudget(): void {
    if (this.budgetForm.invalid) {
      this.budgetForm.markAllAsTouched();
      return;
    }

    const activeUser = this.auth.getActiveUser();
    if (!activeUser) {
      return;
    }

    const value = this.budgetForm.getRawValue();
    this.appState.addBudget({
      id: createId(),
      categoryId: value.categoryId ?? '',
      limit: Number(value.limit),
      period: (value.period ?? 'monthly') as 'weekly' | 'monthly',
      scope: (value.scope ?? 'shared') as Scope,
      ownerId: activeUser.id,
      householdId: activeUser.householdId
    });

    this.budgetForm.reset({
      categoryId: this.categories()[0]?.id ?? '',
      limit: 0,
      period: 'monthly',
      scope: 'shared'
    });

    this.showBudgetForm = false;
  }

  addCategory(): void {
    if (this.categoryForm.invalid) {
      this.categoryForm.markAllAsTouched();
      return;
    }

    const value = this.categoryForm.getRawValue();
    this.appState.addCategory({
      id: createId(),
      name: value.name ?? 'New category',
      color: value.color ?? '#0ea5e9',
      icon: value.icon ?? 'tag',
      defaultScope: (value.defaultScope ?? 'shared') as Scope
    });

    this.categoryForm.reset({
      name: '',
      color: '#0ea5e9',
      icon: 'tag',
      defaultScope: 'shared'
    });
    this.showCategoryForm = false;
  }
}
