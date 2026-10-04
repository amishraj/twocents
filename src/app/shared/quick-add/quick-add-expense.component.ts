import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { ToastService } from '../toast/toast.service';
import { CategoryModalComponent } from '../category-modal/category-modal.component';
import { SheetComponent } from '../sheet/sheet.component';
import { IconComponent } from '../icon/icon.component';
import { RecurringTemplate, Scope, TransactionType } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';
import { buildRecurringKey, localDateToIso, parseLocalDateParts, todayLocalDate } from '../../core/utils/dates';
import { addDays } from '../../core/utils/periods';
import { isPositiveAmount, normalizeAmount } from '../../core/utils/money';

type DatePick = 'today' | 'yesterday' | 'custom';

@Component({
  selector: 'app-quick-add-expense',
  standalone: true,
  imports: [ReactiveFormsModule, CategoryModalComponent, SheetComponent, IconComponent],
  templateUrl: './quick-add-expense.component.html',
  styleUrl: './quick-add-expense.component.scss'
})
export class QuickAddExpenseComponent {
  private readonly fb = inject(FormBuilder);
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  readonly currency = inject(CurrencyService);
  readonly ui = inject(UiStateService);

  readonly activeUser = computed(() => this.auth.getActiveUser());
  readonly hasHousehold = computed(() => Boolean(this.activeUser()?.householdId?.trim()));
  readonly members = computed(() => {
    const user = this.activeUser();
    if (!user?.householdId) {
      return [];
    }
    return this.appState.householdById(user.householdId)?.members ?? [];
  });
  readonly categories = computed(() =>
    this.appState
      .categories()
      .filter((c) => c.name.trim().toLowerCase() !== 'income')
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  );

  readonly type = signal<TransactionType>('expense');
  readonly datePick = signal<DatePick>('today');
  readonly showNotes = signal(false);
  readonly showCategoryModal = signal(false);
  readonly submitting = signal(false);

  form = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    title: ['', Validators.required],
    categoryId: [''],
    date: [todayLocalDate(), Validators.required],
    scope: ['personal' as Scope, Validators.required],
    paidByUserId: ['', Validators.required],
    recurring: [false],
    notes: ['']
  });

  readonly recurringDay = computed(() => {
    const date = this.formDate();
    return parseLocalDateParts(date)?.day ?? new Date().getDate();
  });
  private readonly formDate = signal(todayLocalDate());

  constructor() {
    // Reset to sensible defaults every time the sheet opens, applying any preset
    // the caller passed (e.g. "add income" from the household page).
    // Only the open flag and preset are tracked; everything resetForm reads
    // (categories, user) is untracked so creating a category mid-entry doesn't
    // wipe what the user already typed.
    effect(() => {
      if (!this.ui.quickAddOpen()) {
        return;
      }
      const preset = this.ui.quickAddPreset();
      untracked(() => this.resetForm(preset?.type ?? 'expense', preset?.categoryId, preset?.date));
    }, { allowSignalWrites: true });

    this.form.controls.date.valueChanges.subscribe((value) => this.formDate.set(value ?? todayLocalDate()));
  }

  private resetForm(type: TransactionType, categoryId?: string, date?: string): void {
    const user = this.activeUser();
    const household = this.hasHousehold();
    const defaultCategory = categoryId ?? this.categories()[0]?.id ?? '';
    const category = this.appState.categoryById(defaultCategory);
    const today = todayLocalDate();
    const pickedDate = date ?? today;
    this.type.set(type);
    this.datePick.set(pickedDate === today ? 'today' : pickedDate === addDays(today, -1) ? 'yesterday' : 'custom');
    this.showNotes.set(false);
    this.form.reset({
      amount: null,
      title: '',
      categoryId: type === 'expense' ? defaultCategory : '',
      date: pickedDate,
      scope: household ? (category?.defaultScope ?? 'shared') : 'personal',
      paidByUserId: user?.id ?? '',
      recurring: false,
      notes: ''
    });
    this.formDate.set(pickedDate);
  }

  setType(type: TransactionType): void {
    this.type.set(type);
    if (type === 'expense' && !this.form.value.categoryId) {
      this.form.patchValue({ categoryId: this.categories()[0]?.id ?? '' });
    }
  }

  pickCategory(id: string): void {
    this.form.patchValue({ categoryId: id });
    const category = this.appState.categoryById(id);
    if (category && this.hasHousehold() && !this.form.controls.scope.dirty) {
      this.form.patchValue({ scope: category.defaultScope });
    }
  }

  setScope(scope: Scope): void {
    this.form.patchValue({ scope });
    this.form.controls.scope.markAsDirty();
  }

  pickDate(pick: DatePick): void {
    this.datePick.set(pick);
    const today = todayLocalDate();
    if (pick === 'today') {
      this.form.patchValue({ date: today });
    } else if (pick === 'yesterday') {
      this.form.patchValue({ date: addDays(today, -1) });
    }
  }

  toggleRecurring(): void {
    this.form.patchValue({ recurring: !this.form.value.recurring });
  }

  onCategorySaved(id: string): void {
    this.showCategoryModal.set(false);
    this.pickCategory(id);
  }

  close(): void {
    this.ui.closeQuickAdd();
  }

  submit(keepOpen = false): void {
    const type = this.type();
    const value = this.form.getRawValue();

    if (!isPositiveAmount(value.amount)) {
      this.form.controls.amount.markAsTouched();
      this.toast.warning('Enter an amount greater than zero.');
      return;
    }
    if (!(value.title ?? '').trim()) {
      this.form.controls.title.markAsTouched();
      this.toast.warning(type === 'income' ? 'Describe where the money came from.' : 'Describe what you paid for.');
      return;
    }

    let categoryId = value.categoryId ?? '';
    const scope: Scope = this.hasHousehold() ? ((value.scope ?? 'shared') as Scope) : 'personal';
    if (type === 'income') {
      categoryId = this.appState.ensureIncomeCategoryId(scope);
    } else if (!categoryId) {
      this.toast.warning('Pick a category, or create one.');
      return;
    }

    const localDate = value.date || todayLocalDate();
    const isoDate = localDateToIso(localDate);
    const amount = normalizeAmount(value.amount);
    const paidByUserId = value.paidByUserId || this.activeUser()?.id || '';
    const recurringTemplateId = value.recurring ? createId() : undefined;
    const recurringKey = recurringTemplateId ? buildRecurringKey(recurringTemplateId, localDate) ?? undefined : undefined;
    const notes = (value.notes ?? '').trim() || undefined;
    const title = (value.title ?? '').trim();

    this.appState.addTransaction({
      id: createId(),
      title,
      amount,
      type,
      categoryId,
      paidByUserId,
      date: isoDate,
      localDate,
      scope,
      recurring: Boolean(value.recurring),
      recurringTemplateId,
      recurringKey,
      notes
    });

    if (recurringTemplateId) {
      const template: RecurringTemplate = {
        id: recurringTemplateId,
        title,
        amount,
        type,
        categoryId,
        paidByUserId,
        dayOfMonth: parseLocalDateParts(localDate)?.day ?? new Date().getDate(),
        scope,
        startDate: isoDate,
        active: true
      };
      this.appState.addRecurringTemplate(template);
      void this.appState.ensureRecurringUpToDate();
    }

    this.toast.success(
      `${type === 'income' ? 'Income' : 'Expense'} added: ${title} · ${this.currency.format(amount, { decimals: 'always' })}`
    );

    if (keepOpen) {
      const keepCategory = categoryId;
      this.resetForm(type, type === 'expense' ? keepCategory : undefined, localDate);
      return;
    }
    this.close();
  }
}
