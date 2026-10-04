import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { RecurringTemplate, Scope, Transaction, TransactionType } from '../../core/models/app.models';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { InsightsService } from '../../core/services/insights.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ToastService } from '../../shared/toast/toast.service';
import { CategoryModalComponent } from '../../shared/category-modal/category-modal.component';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { SheetComponent } from '../../shared/sheet/sheet.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { TransactionRowComponent } from '../../shared/transaction-row/transaction-row.component';
import { coerceLegacyToLocalDate, localDateToIso, todayLocalDate } from '../../core/utils/dates';
import { DateRange, addMonths, monthRange, rangeLabel, relativeDayLabel, shortDate } from '../../core/utils/periods';
import {
  ScopeFilter,
  TypeFilter,
  groupByDay,
  isExpense,
  isIncome,
  matchesScope,
  matchesType,
  sumAmounts,
  txInRange,
  txLocalDate
} from '../../core/utils/transactions';
import { isPositiveAmount, normalizeAmount } from '../../core/utils/money';

type RangePreset = 'all' | 'month' | 'last-month' | 'quarter' | 'custom';
type View = 'all' | 'recurring';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MoneyPipe,
    CategoryModalComponent,
    ConfirmModalComponent,
    SheetComponent,
    IconComponent,
    TransactionRowComponent
  ],
  templateUrl: './transactions.component.html',
  styleUrl: './transactions.component.scss'
})
export class TransactionsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  readonly appState = inject(AppStateService);
  readonly insights = inject(InsightsService);
  readonly ui = inject(UiStateService);
  readonly currency = inject(CurrencyService);

  // ── Filters ──
  readonly view = signal<View>('all');
  readonly query = signal('');
  readonly typeFilter = signal<TypeFilter>('all');
  readonly scopeFilter = signal<ScopeFilter>('all');
  readonly categoryFilter = signal<string | null>(null);
  readonly rangePreset = signal<RangePreset>('all');
  readonly customFrom = signal('');
  readonly customTo = signal('');
  readonly filtersOpen = signal(false);

  // ── Editing ──
  readonly editing = signal<Transaction | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly editingTemplate = signal<RecurringTemplate | null>(null);
  readonly confirmStopTemplateId = signal<string | null>(null);
  readonly showCategoryModal = signal(false);

  readonly user = computed(() => this.auth.getActiveUser());
  readonly hasHousehold = computed(() => Boolean(this.user()?.householdId?.trim()));
  readonly members = computed(() => {
    const user = this.user();
    return user ? this.appState.householdById(user.householdId)?.members ?? [] : [];
  });
  readonly categories = computed(() => this.appState.categories().slice().sort((a, b) => a.name.localeCompare(b.name)));
  readonly loaded = computed(() => this.appState.transactionsLoaded());

  readonly range = computed<DateRange | null>(() => {
    const preset = this.rangePreset();
    const today = todayLocalDate();
    switch (preset) {
      case 'month':
        return monthRange(today);
      case 'last-month':
        return monthRange(addMonths(today, -1));
      case 'quarter': {
        const start = monthRange(addMonths(today, -2)).start;
        return { start, end: monthRange(today).end };
      }
      case 'custom': {
        const from = this.customFrom();
        const to = this.customTo();
        if (from && to) {
          return from <= to ? { start: from, end: to } : { start: to, end: from };
        }
        return from ? { start: from, end: '9999-12-31' } : to ? { start: '0000-01-01', end: to } : null;
      }
      default:
        return null;
    }
  });

  readonly rangeText = computed(() => {
    const range = this.range();
    if (!range) {
      return 'All time';
    }
    if (range.end === '9999-12-31') {
      return `From ${shortDate(range.start, true)}`;
    }
    if (range.start === '0000-01-01') {
      return `Until ${shortDate(range.end, true)}`;
    }
    return rangeLabel(range);
  });

  readonly activeFilterCount = computed(
    () =>
      (this.typeFilter() !== 'all' ? 1 : 0) +
      (this.scopeFilter() !== 'all' ? 1 : 0) +
      (this.categoryFilter() ? 1 : 0) +
      (this.rangePreset() !== 'all' ? 1 : 0)
  );

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const numeric = q.length > 0 && !Number.isNaN(Number(q)) ? Math.round(Number(q) * 100) : null;
    const type = this.typeFilter();
    const scope = this.scopeFilter();
    const category = this.categoryFilter();
    const range = this.range();
    return this.appState.transactions().filter((tx) => {
      if (!matchesType(tx, type) || !matchesScope(tx, scope)) {
        return false;
      }
      if (category && tx.categoryId !== category) {
        return false;
      }
      if (range && !txInRange(tx, range)) {
        return false;
      }
      if (!q) {
        return true;
      }
      if (numeric !== null && Math.round(tx.amount * 100) === numeric) {
        return true;
      }
      const haystack = `${tx.title} ${tx.notes ?? ''} ${this.appState.categoryById(tx.categoryId)?.name ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  });

  readonly totals = computed(() => {
    const list = this.filtered();
    return {
      count: list.length,
      spent: sumAmounts(list.filter(isExpense)),
      received: sumAmounts(list.filter(isIncome))
    };
  });

  readonly groups = computed(() => groupByDay(this.filtered()));
  private readonly pageSize = 40;
  readonly visibleCount = signal(this.pageSize);
  readonly visibleGroups = computed(() => {
    let remaining = this.visibleCount();
    const out: ReturnType<typeof groupByDay> = [];
    for (const group of this.groups()) {
      if (remaining <= 0) {
        break;
      }
      out.push(remaining >= group.items.length ? group : { ...group, items: group.items.slice(0, remaining) });
      remaining -= group.items.length;
    }
    return out;
  });
  readonly hiddenCount = computed(() => Math.max(0, this.totals().count - this.visibleCount()));

  // ── Recurring ──
  readonly templates = computed(() =>
    this.appState
      .recurringTemplates()
      .filter((t) => t.active)
      .slice()
      .sort((a, b) => a.dayOfMonth - b.dayOfMonth || a.title.localeCompare(b.title))
      .map((template) => ({
        template,
        category: this.appState.categoryById(template.categoryId),
        nextDue: this.insights.nextDueDate(template)
      }))
  );
  readonly recurringExpense = this.insights.recurringMonthlyExpense;
  readonly recurringIncome = this.insights.recurringMonthlyIncome;

  // ── Forms ──
  editForm = this.fb.group({
    type: ['expense' as TransactionType, Validators.required],
    title: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    categoryId: [''],
    date: ['', Validators.required],
    scope: ['personal' as Scope, Validators.required],
    paidByUserId: [''],
    notes: ['']
  });

  templateForm = this.fb.group({
    title: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    categoryId: [''],
    dayOfMonth: [1, [Validators.required, Validators.min(1), Validators.max(31)]],
    scope: ['personal' as Scope, Validators.required],
    paidByUserId: ['']
  });

  readonly editType = toSignal(this.editForm.controls.type.valueChanges.pipe(map((v) => v ?? 'expense')), {
    initialValue: 'expense' as TransactionType
  });

  constructor() {
    void this.appState.ensureRecurringUpToDate();

    // URL → filters. Lets the overview deep-link into a category + period and
    // lets "edit" links open the sheet directly.
    this.route.queryParamMap.subscribe((params) => {
      if (params.get('view') === 'recurring') {
        this.view.set('recurring');
      }
      const category = params.get('category');
      const from = params.get('from');
      const to = params.get('to');
      const scope = params.get('scope') as ScopeFilter | null;
      const type = params.get('type') as TypeFilter | null;
      if (category) {
        this.categoryFilter.set(category);
      }
      if (from || to) {
        this.customFrom.set(from ?? '');
        this.customTo.set(to ?? '');
        this.rangePreset.set('custom');
      }
      if (scope === 'shared' || scope === 'personal') {
        this.scopeFilter.set(scope);
      }
      if (type === 'expense' || type === 'income') {
        this.typeFilter.set(type);
      }
      if (category || from || to) {
        this.filtersOpen.set(true);
      }
    });

    // Open the editor once the requested transaction is actually loaded.
    effect(() => {
      const requested = this.route.snapshot.queryParamMap.get('edit');
      if (!requested || this.editing()) {
        return;
      }
      const tx = this.appState.transactions().find((item) => item.id === requested);
      if (tx) {
        this.startEdit(tx);
        void this.router.navigate([], { queryParams: { edit: null }, queryParamsHandling: 'merge', replaceUrl: true });
      }
    }, { allowSignalWrites: true });

    // Any filter change restarts paging from the top.
    effect(() => {
      this.query();
      this.typeFilter();
      this.scopeFilter();
      this.categoryFilter();
      this.range();
      this.visibleCount.set(this.pageSize);
    }, { allowSignalWrites: true });
  }

  // ── Filter actions ──
  setView(view: View): void {
    this.view.set(view);
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  setType(type: TypeFilter): void {
    this.typeFilter.set(type);
  }

  setScope(scope: ScopeFilter): void {
    this.scopeFilter.set(scope);
  }

  setCategory(id: string | null): void {
    this.categoryFilter.set(this.categoryFilter() === id ? null : id);
  }

  setRange(preset: RangePreset): void {
    this.rangePreset.set(preset);
    if (preset === 'custom' && !this.customFrom() && !this.customTo()) {
      const month = monthRange(todayLocalDate());
      this.customFrom.set(month.start);
      this.customTo.set(month.end);
    }
  }

  onCustomFrom(event: Event): void {
    this.customFrom.set((event.target as HTMLInputElement).value);
  }

  onCustomTo(event: Event): void {
    this.customTo.set((event.target as HTMLInputElement).value);
  }

  clearFilters(): void {
    this.query.set('');
    this.typeFilter.set('all');
    this.scopeFilter.set('all');
    this.categoryFilter.set(null);
    this.rangePreset.set('all');
    this.customFrom.set('');
    this.customTo.set('');
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  showMore(): void {
    this.visibleCount.update((n) => n + this.pageSize);
  }

  dayLabel(date: string): string {
    return relativeDayLabel(date);
  }

  memberName(id: string): string {
    return this.members().find((m) => m.userId === id)?.displayName ?? '';
  }

  categoryName(id: string): string {
    return this.appState.categoryById(id)?.name ?? 'Uncategorized';
  }

  addTransaction(): void {
    this.ui.openQuickAdd();
  }

  // ── Edit transaction ──
  startEdit(tx: Transaction): void {
    this.editing.set(tx);
    this.editForm.reset({
      type: tx.type ?? 'expense',
      title: tx.title,
      amount: tx.amount,
      categoryId: tx.categoryId,
      date: txLocalDate(tx) || todayLocalDate(),
      scope: tx.scope,
      paidByUserId: tx.paidByUserId,
      notes: tx.notes ?? ''
    });
  }

  cancelEdit(): void {
    this.editing.set(null);
  }

  onEditCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '__new__') {
      this.showCategoryModal.set(true);
      this.editForm.patchValue({ categoryId: this.editing()?.categoryId ?? '' });
    }
  }

  onCategorySaved(id: string): void {
    this.showCategoryModal.set(false);
    if (this.editingTemplate()) {
      this.templateForm.patchValue({ categoryId: id });
    } else {
      this.editForm.patchValue({ categoryId: id });
    }
  }

  saveEdit(): void {
    const current = this.editing();
    if (!current) {
      return;
    }
    const value = this.editForm.getRawValue();
    if (!isPositiveAmount(value.amount) || !(value.title ?? '').trim() || !value.date) {
      this.editForm.markAllAsTouched();
      this.toast.warning('Fill in a description, an amount above zero and a date.');
      return;
    }
    const type = (value.type ?? 'expense') as TransactionType;
    const scope: Scope = this.hasHousehold() ? ((value.scope ?? 'personal') as Scope) : 'personal';
    let categoryId = value.categoryId ?? current.categoryId;
    if (type === 'income') {
      categoryId = this.appState.ensureIncomeCategoryId(scope);
    } else if (!categoryId) {
      this.toast.warning('Pick a category for this expense.');
      return;
    }
    const localDate = value.date;
    this.appState.updateTransaction({
      ...current,
      type,
      title: (value.title ?? '').trim(),
      amount: normalizeAmount(value.amount),
      categoryId,
      scope,
      paidByUserId: value.paidByUserId || current.paidByUserId,
      localDate,
      date: localDateToIso(localDate),
      notes: (value.notes ?? '').trim() || undefined
    });
    this.editing.set(null);
    this.toast.success('Transaction updated.');
  }

  requestDelete(id: string): void {
    this.confirmDeleteId.set(id);
  }

  confirmDelete(): void {
    const id = this.confirmDeleteId();
    if (!id) {
      return;
    }
    this.appState.removeTransaction(id);
    this.confirmDeleteId.set(null);
    if (this.editing()?.id === id) {
      this.editing.set(null);
    }
    this.toast.success('Transaction deleted.');
  }

  // ── Recurring ──
  startEditTemplate(template: RecurringTemplate): void {
    this.editingTemplate.set(template);
    this.templateForm.reset({
      title: template.title,
      amount: template.amount,
      categoryId: template.categoryId,
      dayOfMonth: template.dayOfMonth,
      scope: template.scope,
      paidByUserId: template.paidByUserId
    });
  }

  onTemplateCategoryChange(event: Event): void {
    if ((event.target as HTMLSelectElement).value === '__new__') {
      this.showCategoryModal.set(true);
      this.templateForm.patchValue({ categoryId: this.editingTemplate()?.categoryId ?? '' });
    }
  }

  saveTemplate(): void {
    const current = this.editingTemplate();
    if (!current) {
      return;
    }
    const value = this.templateForm.getRawValue();
    const day = Number(value.dayOfMonth);
    if (!isPositiveAmount(value.amount) || !(value.title ?? '').trim() || !Number.isInteger(day) || day < 1 || day > 31) {
      this.templateForm.markAllAsTouched();
      this.toast.warning('Fill in a title, an amount above zero and a day between 1 and 31.');
      return;
    }
    const scope: Scope = this.hasHousehold() ? ((value.scope ?? 'personal') as Scope) : 'personal';
    this.appState.updateRecurringTemplate({
      ...current,
      title: (value.title ?? '').trim(),
      amount: normalizeAmount(value.amount),
      categoryId: current.type === 'income' ? current.categoryId : value.categoryId || current.categoryId,
      dayOfMonth: day,
      scope,
      paidByUserId: value.paidByUserId || current.paidByUserId
    });
    this.editingTemplate.set(null);
    this.toast.success('Recurring series updated. Future entries use the new values.');
  }

  requestStopTemplate(id: string): void {
    this.confirmStopTemplateId.set(id);
  }

  confirmStopTemplate(): void {
    const id = this.confirmStopTemplateId();
    if (!id) {
      return;
    }
    this.appState.deleteRecurringTemplate(id);
    this.confirmStopTemplateId.set(null);
    if (this.editingTemplate()?.id === id) {
      this.editingTemplate.set(null);
    }
    this.toast.success('Series stopped. Past entries are kept.');
  }

  ordinal(day: number): string {
    const suffix =
      day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
    return `${day}${suffix}`;
  }

  dueText(nextDue: string): string {
    return relativeDayLabel(nextDue);
  }

  fixTxDate(tx: Transaction): string {
    return coerceLegacyToLocalDate(tx.date) ?? todayLocalDate();
  }
}
