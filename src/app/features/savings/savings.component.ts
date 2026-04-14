import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../shared/toast/toast.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { Scope } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';

@Component({
  selector: 'app-savings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ConfirmModalComponent],
  templateUrl: './savings.component.html',
  styleUrl: './savings.component.scss'
})
export class SavingsComponent {
  private readonly fb = inject(FormBuilder);
  public appState = inject(AppStateService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  contributionInput = signal<Record<string, number>>({});
  editingGoalId = signal<string | null>(null);
  confirmDeleteGoalId = signal<string | null>(null);
  savingsGoals = computed(() => this.appState.savingsGoals());
  hasHousehold = computed(() => Boolean(this.auth.getActiveUser()?.householdId?.trim()));

  showForm = false;

  form = this.fb.group({
    name: ['', Validators.required],
    targetAmount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    currentAmount: [0, [Validators.required, Validators.min(0)]],
    accountName: ['', Validators.required],
    scope: ['shared', Validators.required]
  });

  editGoalForm = this.fb.group({
    name: ['', Validators.required],
    accountName: ['', Validators.required],
    targetAmount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    currentAmount: [0, [Validators.required, Validators.min(0)]],
    scope: ['shared', Validators.required]
  });

  toggleForm(): void {
    this.showForm = !this.showForm;
  }

  addGoal(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.warning('Please fill in all required fields.');
      return;
    }

    const value = this.form.getRawValue();
    const selectedScope = (value.scope ?? 'shared') as Scope;
    const resolvedScope = !this.hasHousehold() && selectedScope === 'shared' ? 'personal' : selectedScope;
    if (selectedScope === 'shared' && resolvedScope === 'personal') {
      this.toast.info('Shared savings goals are locked until you join or create a household. Saved as personal.');
    }

    this.appState.addSavingsGoal({
      id: createId(),
      name: value.name ?? 'Goal',
      targetAmount: Number(value.targetAmount),
      currentAmount: Number(value.currentAmount),
      accountName: value.accountName ?? 'Savings',
      scope: resolvedScope
    });

    this.toast.success(`Savings goal "${value.name}" created.`);

    this.form.reset({
      name: '',
      targetAmount: null,
      currentAmount: 0,
      accountName: '',
      scope: this.hasHousehold() ? 'shared' : 'personal'
    });
    this.showForm = false;
  }

  setContribution(goalId: string, value: string): void {
    const amount = Number(value);
    this.contributionInput.set({
      ...this.contributionInput(),
      [goalId]: Number.isFinite(amount) ? amount : 0
    });
  }

  addContribution(goalId: string): void {
    const amount = this.contributionInput()[goalId] ?? 0;
    if (amount <= 0) {
      return;
    }

    const activeUserId = this.auth.getActiveUser()?.id;
    const added = this.appState.addSavingsContribution(goalId, amount, activeUserId);
    if (!added) {
      this.toast.warning('Unable to add contribution right now.');
      return;
    }

    this.toast.success(`$${amount} contributed.`);
    this.contributionInput.set({
      ...this.contributionInput(),
      [goalId]: 0
    });
  }

  startEditGoal(goalId: string): void {
    const goal = this.appState.savingsGoals().find((item) => item.id === goalId);
    if (!goal) {
      return;
    }

    this.editingGoalId.set(goalId);
    this.editGoalForm.patchValue({
      name: goal.name,
      accountName: goal.accountName,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      scope: goal.scope
    });
  }

  cancelEditGoal(): void {
    this.editingGoalId.set(null);
  }

  setEditCurrentAmount(value: string): void {
    const parsed = Number(value);
    this.editGoalForm.patchValue({
      currentAmount: Number.isFinite(parsed) ? Math.max(parsed, 0) : 0
    });
  }

  setEditTargetAmount(value: string): void {
    const parsed = Number(value);
    const nextTarget = Number.isFinite(parsed) ? Math.max(parsed, 0.01) : 0.01;
    const currentAmount = Number(this.editGoalForm.value.currentAmount ?? 0);
    this.editGoalForm.patchValue({
      targetAmount: nextTarget,
      currentAmount: Math.min(currentAmount, nextTarget)
    });
  }

  saveGoalEdit(goalId: string): void {
    if (this.editGoalForm.invalid) {
      this.editGoalForm.markAllAsTouched();
      this.toast.warning('Please fill in all required fields.');
      return;
    }

    const value = this.editGoalForm.getRawValue();
    const selectedScope = (value.scope ?? 'shared') as Scope;
    const resolvedScope = !this.hasHousehold() && selectedScope === 'shared' ? 'personal' : selectedScope;
    if (selectedScope === 'shared' && resolvedScope === 'personal') {
      this.toast.info('Shared savings goals are locked until you join or create a household. Saved as personal.');
    }

    const currentAmount = Number(value.currentAmount ?? 0);
    let targetAmount = Number(value.targetAmount ?? 0);
    if (targetAmount < currentAmount) {
      targetAmount = currentAmount;
      this.toast.info('Target amount adjusted to match current amount.');
    }

    const nextGoals = this.appState.savingsGoals().map((goal) =>
      goal.id === goalId
        ? {
            ...goal,
            name: value.name ?? goal.name,
            accountName: value.accountName ?? goal.accountName,
            currentAmount,
            targetAmount,
            scope: resolvedScope
          }
        : goal
    );

    this.appState.updateSavings(nextGoals);
    this.editingGoalId.set(null);
    this.toast.success('Savings goal updated.');
  }

  requestRemoveGoal(goalId: string): void {
    this.confirmDeleteGoalId.set(goalId);
  }

  cancelRemoveGoal(): void {
    this.confirmDeleteGoalId.set(null);
  }

  removeGoal(): void {
    const goalId = this.confirmDeleteGoalId();
    if (!goalId) {
      return;
    }

    const goal = this.appState.savingsGoals().find((item) => item.id === goalId);
    if (!goal) {
      this.confirmDeleteGoalId.set(null);
      return;
    }

    if (goal.currentAmount > 0) {
      this.confirmDeleteGoalId.set(null);
      this.toast.warning('You can only delete this goal when current amount is $0.00.');
      return;
    }

    this.appState.removeSavingsGoal(goalId);
    this.confirmDeleteGoalId.set(null);
    if (this.editingGoalId() === goalId) {
      this.editingGoalId.set(null);
    }
    this.toast.success('Savings goal deleted.');
  }

  goalProgress(goalId: string): number {
    const goal = this.appState.savingsGoals().find((item) => item.id === goalId);
    if (!goal || goal.targetAmount <= 0) {
      return 0;
    }

    return Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
  }

  goalProgressColor(goalId: string): string {
    const progress = this.goalProgress(goalId);
    const hue = Math.max(0, Math.min(120, Math.round((progress / 100) * 120)));
    return `hsl(${hue} 78% 48%)`;
  }

  goalTone(goalId: string): 'danger' | 'warning' | 'success' {
    const progress = this.goalProgress(goalId);
    if (progress >= 80) {
      return 'success';
    }
    if (progress >= 40) {
      return 'warning';
    }
    return 'danger';
  }

  goalStatus(goalId: string): string {
    const tone = this.goalTone(goalId);
    if (tone === 'success') {
      return 'Near goal';
    }
    if (tone === 'warning') {
      return 'On track';
    }
    return 'Behind';
  }
}
