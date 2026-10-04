import { Component, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Budget, BudgetCategory, Period, Scope } from '../../core/models/app.models';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { BudgetSummary, InsightsService } from '../../core/services/insights.service';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ToastService } from '../../shared/toast/toast.service';
import { CategoryModalComponent } from '../../shared/category-modal/category-modal.component';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { SheetComponent } from '../../shared/sheet/sheet.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { TransactionRowComponent } from '../../shared/transaction-row/transaction-row.component';
import { createId } from '../../core/utils/id';
import { todayLocalDate } from '../../core/utils/dates';
import { monthRange, rangeLabel, weekRange } from '../../core/utils/periods';
import { isPositiveAmount, normalizeAmount } from '../../core/utils/money';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    MoneyPipe,
    CategoryModalComponent,
    ConfirmModalComponent,
    SheetComponent,
    IconComponent,
    TransactionRowComponent
  ],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss'
})
export class BudgetsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly appState = inject(AppStateService);
  readonly insights = inject(InsightsService);
  readonly currency = inject(CurrencyService);

  readonly editing = signal<Budget | null>(null);
  readonly creating = signal(false);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly expandedId = signal<string | null>(null);
  readonly showCategoryModal = signal(false);
  readonly editingCategory = signal<BudgetCategory | null>(null);
  readonly confirmDeleteCategoryId = signal<string | null>(null);
  readonly categoriesOpen = signal(false);

  readonly user = computed(() => this.auth.getActiveUser());
  readonly hasHousehold = computed(() => Boolean(this.user()?.householdId?.trim()));
  readonly memberCount = computed(() => {
    const user = this.user();
    return user ? this.appState.householdById(user.householdId)?.members.length ?? 1 : 1;
  });
  readonly categories = computed(() => this.appState.categories().slice().sort((a, b) => a.name.localeCompare(b.name)));
  readonly expenseCategories = computed(() => this.categories().filter((c) => c.name.trim().toLowerCase() !== 'income'));

  readonly summaries = computed(() => this.insights.budgetSummaries());
  readonly monthly = computed(() => this.summaries().filter((s) => s.budget.period === 'monthly'));
  readonly weekly = computed(() => this.summaries().filter((s) => s.budget.period === 'weekly'));
  readonly monthLabel = computed(() => rangeLabel(monthRange(todayLocalDate())));
  readonly weekLabel = computed(() => rangeLabel(weekRange(todayLocalDate(), this.user()?.preferences.weekStartsOn ?? 1)));

  readonly overview = computed(() => {
    const monthly = this.monthly();
    const limit = monthly.reduce((sum, s) => sum + s.budget.limit, 0);
    const spent = monthly.reduce((sum, s) => sum + s.spent, 0);
    return {
      limit,
      spent,
      remaining: limit - spent,
      percent: limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0,
      over: this.summaries().filter((s) => s.status === 'over').length,
      warning: this.summaries().filter((s) => s.status === 'warning').length,
      ok: this.summaries().filter((s) => s.status === 'ok').length
    };
  });

  readonly categoryRows = computed(() =>
    this.categories().map((category) => ({ category, usage: this.appState.categoryUsage(category.id) }))
  );

  form = this.fb.group({
    categoryId: ['', Validators.required],
    limit: [null as number | null, [Validators.required, Validators.min(0.01)]],
    period: ['monthly' as Period, Validators.required],
    scope: ['personal' as Scope, Validators.required]
  });

  constructor() {
    // Deep link from the overview: expand the requested budget.
    effect(() => {
      const focus = this.route.snapshot.queryParamMap.get('focus');
      if (focus && this.summaries().some((s) => s.budget.id === focus)) {
        this.expandedId.set(focus);
        void this.router.navigate([], { queryParams: {}, replaceUrl: true });
        setTimeout(() => document.getElementById(`budget-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      }
    }, { allowSignalWrites: true });
  }

  statusLabel(status: BudgetSummary['status']): string {
    return status === 'over' ? 'Over budget' : status === 'warning' ? 'Getting close' : 'On track';
  }

  pacePercent(item: BudgetSummary): number {
    return item.budget.limit > 0 ? Math.min(100, (item.expectedToDate / item.budget.limit) * 100) : 0;
  }

  toggleExpand(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  openCreate(): void {
    this.editing.set(null);
    const first = this.expenseCategories()[0];
    this.form.reset({
      categoryId: first?.id ?? '',
      limit: null,
      period: 'monthly',
      scope: this.hasHousehold() ? (first?.defaultScope ?? 'shared') : 'personal'
    });
    this.creating.set(true);
  }

  openEdit(budget: Budget): void {
    this.creating.set(false);
    this.editing.set(budget);
    this.form.reset({
      categoryId: budget.categoryId,
      limit: budget.limit,
      period: budget.period,
      scope: budget.scope
    });
  }

  closeForm(): void {
    this.creating.set(false);
    this.editing.set(null);
  }

  onCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '__new__') {
      this.showCategoryModal.set(true);
      this.form.patchValue({ categoryId: this.editing()?.categoryId ?? this.expenseCategories()[0]?.id ?? '' });
      return;
    }
    const category = this.appState.categoryById(value);
    if (category && this.hasHousehold() && !this.editing()) {
      this.form.patchValue({ scope: category.defaultScope });
    }
  }

  onCategorySaved(id: string): void {
    this.showCategoryModal.set(false);
    if (this.creating() || this.editing()) {
      this.form.patchValue({ categoryId: id });
    }
    this.editingCategory.set(null);
  }

  save(): void {
    const value = this.form.getRawValue();
    if (!value.categoryId || !isPositiveAmount(value.limit)) {
      this.form.markAllAsTouched();
      this.toast.warning(value.categoryId ? 'Enter a limit above zero.' : 'Pick a category for this budget.');
      return;
    }
    const user = this.user();
    if (!user) {
      return;
    }
    const scope: Scope = this.hasHousehold() ? ((value.scope ?? 'personal') as Scope) : 'personal';
    const period = (value.period ?? 'monthly') as Period;
    const limit = normalizeAmount(value.limit);

    const duplicate = this.appState
      .budgets()
      .find(
        (b) =>
          b.id !== this.editing()?.id &&
          b.categoryId === value.categoryId &&
          b.period === period &&
          b.scope === scope &&
          (scope === 'shared' || b.ownerId === user.id)
      );
    if (duplicate) {
      this.toast.warning('You already have a budget for that category and period. Edit it instead.');
      return;
    }

    const current = this.editing();
    if (current) {
      this.appState.updateBudget({ ...current, categoryId: value.categoryId, limit, period, scope });
      this.toast.success('Budget updated.');
    } else {
      this.appState.addBudget({
        id: createId(),
        categoryId: value.categoryId,
        limit,
        period,
        scope,
        ownerId: user.id,
        householdId: user.householdId
      });
      this.toast.success('Budget created.');
    }
    this.closeForm();
  }

  requestDelete(id: string): void {
    this.confirmDeleteId.set(id);
  }

  confirmDelete(): void {
    const id = this.confirmDeleteId();
    if (!id) {
      return;
    }
    this.appState.removeBudget(id);
    this.confirmDeleteId.set(null);
    if (this.editing()?.id === id) {
      this.closeForm();
    }
    this.toast.success('Budget removed. Your transactions are untouched.');
  }

  viewTransactions(item: BudgetSummary): void {
    void this.router.navigate(['/transactions'], {
      queryParams: {
        category: item.budget.categoryId,
        from: item.range.start,
        to: item.range.end,
        scope: item.budget.scope,
        type: 'expense'
      }
    });
  }

  // ── Categories ──
  editCategory(category: BudgetCategory): void {
    this.editingCategory.set(category);
  }

  requestDeleteCategory(id: string): void {
    this.confirmDeleteCategoryId.set(id);
  }

  confirmDeleteCategory(): void {
    const id = this.confirmDeleteCategoryId();
    if (!id) {
      return;
    }
    const removed = this.appState.removeCategory(id);
    this.confirmDeleteCategoryId.set(null);
    if (removed) {
      this.toast.success('Category deleted.');
    } else {
      this.toast.warning('This category is still in use, so it was kept.');
    }
  }
}
