import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { RecurringTemplate, Scope } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';

@Component({
  selector: 'app-quick-add-expense',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './quick-add-expense.component.html',
  styleUrl: './quick-add-expense.component.scss'
})
export class QuickAddExpenseComponent {
  private readonly fb = inject(FormBuilder);
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  public ui = inject(UiStateService);

  categories = computed(() => this.appState.categories());
  activeUser = computed(() => this.auth.getActiveUser());

  form = this.fb.group({
    title: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    categoryId: ['', Validators.required],
    paidByUserId: ['', Validators.required],
    date: [new Date().toISOString().slice(0, 10), Validators.required],
    scope: ['shared', Validators.required],
    recurring: [false]
  });

  constructor() {
    const activeUser = this.auth.getActiveUser();
    if (activeUser) {
      this.form.patchValue({
        paidByUserId: activeUser.id
      });
    }

    if (this.categories().length > 0) {
      this.form.patchValue({ categoryId: this.categories()[0].id });
    }
  }

  close(): void {
    this.ui.closeQuickAdd();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const dateValue = value.date ?? new Date().toISOString().slice(0, 10);
    const isoDate = new Date(`${dateValue}T12:00:00`).toISOString();

    const recurringTemplateId = value.recurring ? createId() : undefined;
    const dueDate = new Date(isoDate);
    const recurringKey = recurringTemplateId
      ? `${recurringTemplateId}_${dueDate.getFullYear()}_${dueDate.getMonth() + 1}`
      : undefined;

    this.appState.addTransaction({
      id: createId(),
      title: value.title ?? '',
      amount: Number(value.amount),
      categoryId: value.categoryId ?? '',
      paidByUserId: value.paidByUserId ?? '',
      date: isoDate,
      scope: (value.scope ?? 'shared') as Scope,
      recurring: Boolean(value.recurring),
      recurringTemplateId,
      recurringKey
    });

    if (value.recurring && recurringTemplateId) {
      const template: RecurringTemplate = {
        id: recurringTemplateId,
        title: value.title ?? '',
        amount: Number(value.amount),
        categoryId: value.categoryId ?? '',
        paidByUserId: value.paidByUserId ?? '',
        dayOfMonth: dueDate.getDate(),
        scope: (value.scope ?? 'shared') as Scope,
        startDate: isoDate,
        active: true
      };
      this.appState.addRecurringTemplate(template);
      void this.appState.ensureRecurringUpToDate();
    }

    this.form.reset({
      title: '',
      amount: null,
      categoryId: this.categories()[0]?.id ?? '',
      paidByUserId: this.activeUser()?.id ?? '',
      date: new Date().toISOString().slice(0, 10),
      scope: 'shared',
      recurring: false
    });

    this.close();
  }
}
