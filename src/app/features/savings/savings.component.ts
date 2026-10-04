import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SavingsGoal, Scope } from '../../core/models/app.models';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ToastService } from '../../shared/toast/toast.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { SheetComponent } from '../../shared/sheet/sheet.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { createId } from '../../core/utils/id';
import { isPositiveAmount, normalizeAmount } from '../../core/utils/money';
import { shortDate } from '../../core/utils/periods';

interface GoalView {
  goal: SavingsGoal;
  percent: number;
  remaining: number;
  status: 'done' | 'ok' | 'warn' | 'behind';
  statusLabel: string;
  dueLabel: string | null;
  monthlyNeeded: number | null;
}

@Component({
  selector: 'app-savings',
  standalone: true,
  imports: [ReactiveFormsModule, MoneyPipe, ConfirmModalComponent, SheetComponent, IconComponent],
  templateUrl: './savings.component.html',
  styleUrl: './savings.component.scss'
})
export class SavingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  readonly appState = inject(AppStateService);
  readonly currency = inject(CurrencyService);

  readonly editing = signal<SavingsGoal | null>(null);
  readonly creating = signal(false);
  readonly contributingTo = signal<SavingsGoal | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);

  readonly hasHousehold = computed(() => Boolean(this.auth.getActiveUser()?.householdId?.trim()));

  readonly goals = computed<GoalView[]>(() =>
    this.appState
      .savingsGoals()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((goal) => this.describe(goal))
  );

  readonly totals = computed(() => {
    const goals = this.appState.savingsGoals();
    const saved = goals.reduce((sum, g) => sum + g.currentAmount, 0);
    const target = goals.reduce((sum, g) => sum + g.targetAmount, 0);
    return {
      saved,
      target,
      percent: target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0,
      reached: goals.filter((g) => g.targetAmount > 0 && g.currentAmount >= g.targetAmount).length
    };
  });

  form = this.fb.group({
    name: ['', Validators.required],
    targetAmount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    currentAmount: [0, [Validators.required, Validators.min(0)]],
    accountName: [''],
    dueDate: [''],
    scope: ['personal' as Scope, Validators.required]
  });

  contributionForm = this.fb.group({
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    logTransaction: [true]
  });

  private describe(goal: SavingsGoal): GoalView {
    const percent = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    let monthlyNeeded: number | null = null;
    let dueLabel: string | null = null;
    if (goal.dueDate) {
      const due = goal.dueDate.slice(0, 10);
      dueLabel = shortDate(due, true);
      const months = Math.max(1, Math.ceil((Date.parse(due) - Date.now()) / (30.4 * 86_400_000)));
      monthlyNeeded = remaining > 0 ? Math.ceil(remaining / months) : 0;
    }
    let status: GoalView['status'] = 'behind';
    if (remaining === 0) {
      status = 'done';
    } else if (percent >= 66) {
      status = 'ok';
    } else if (percent >= 33) {
      status = 'warn';
    }
    const statusLabel = status === 'done' ? 'Reached' : status === 'ok' ? 'Almost there' : status === 'warn' ? 'Halfway' : 'Just started';
    return { goal, percent, remaining, status, statusLabel, dueLabel, monthlyNeeded };
  }

  openCreate(): void {
    this.editing.set(null);
    this.form.reset({
      name: '',
      targetAmount: null,
      currentAmount: 0,
      accountName: '',
      dueDate: '',
      scope: this.hasHousehold() ? 'shared' : 'personal'
    });
    this.creating.set(true);
  }

  openEdit(goal: SavingsGoal): void {
    this.creating.set(false);
    this.editing.set(goal);
    this.form.reset({
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      accountName: goal.accountName,
      dueDate: goal.dueDate ? goal.dueDate.slice(0, 10) : '',
      scope: goal.scope
    });
  }

  closeForm(): void {
    this.creating.set(false);
    this.editing.set(null);
  }

  save(): void {
    const value = this.form.getRawValue();
    if (!(value.name ?? '').trim() || !isPositiveAmount(value.targetAmount)) {
      this.form.markAllAsTouched();
      this.toast.warning('Give the goal a name and a target above zero.');
      return;
    }
    const scope: Scope = this.hasHousehold() ? ((value.scope ?? 'personal') as Scope) : 'personal';
    const current = normalizeAmount(value.currentAmount ?? 0);
    const target = normalizeAmount(value.targetAmount);
    const next: SavingsGoal = {
      id: this.editing()?.id ?? createId(),
      name: (value.name ?? '').trim(),
      targetAmount: target,
      currentAmount: Math.max(0, current),
      accountName: (value.accountName ?? '').trim(),
      dueDate: value.dueDate ? value.dueDate : undefined,
      scope
    };
    if (this.editing()) {
      this.appState.updateSavingsGoal(next);
      this.toast.success('Goal updated.');
    } else {
      this.appState.addSavingsGoal(next);
      this.toast.success(`Goal "${next.name}" created.`);
    }
    this.closeForm();
  }

  openContribute(goal: SavingsGoal): void {
    this.contributionForm.reset({ amount: null, logTransaction: true });
    this.contributingTo.set(goal);
  }

  contribute(): void {
    const goal = this.contributingTo();
    if (!goal) {
      return;
    }
    const value = this.contributionForm.getRawValue();
    if (!isPositiveAmount(value.amount)) {
      this.contributionForm.markAllAsTouched();
      this.toast.warning('Enter an amount above zero.');
      return;
    }
    const amount = normalizeAmount(value.amount);
    if (value.logTransaction) {
      const ok = this.appState.addSavingsContribution(goal.id, amount, this.auth.getActiveUser()?.id);
      if (!ok) {
        this.toast.error('Could not record the contribution. Please try again.');
        return;
      }
    } else {
      this.appState.updateSavingsGoal({ ...goal, currentAmount: normalizeAmount(goal.currentAmount + amount) });
    }
    this.contributingTo.set(null);
    this.toast.success(`${this.currency.format(amount, { decimals: 'always' })} added to ${goal.name}.`);
  }

  requestDelete(id: string): void {
    this.confirmDeleteId.set(id);
  }

  confirmDelete(): void {
    const id = this.confirmDeleteId();
    if (!id) {
      return;
    }
    this.appState.removeSavingsGoal(id);
    this.confirmDeleteId.set(null);
    if (this.editing()?.id === id) {
      this.closeForm();
    }
    this.toast.success('Goal deleted. Contribution transactions were kept.');
  }
}
