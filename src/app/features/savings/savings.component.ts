import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { ToastService } from '../../shared/toast/toast.service';
import { Scope } from '../../core/models/app.models';
import { createId } from '../../core/utils/id';

@Component({
  selector: 'app-savings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './savings.component.html',
  styleUrl: './savings.component.scss'
})
export class SavingsComponent {
  private readonly fb = inject(FormBuilder);
  public appState = inject(AppStateService);
  private readonly toast = inject(ToastService);
  contributionInput = signal<Record<string, number>>({});
  savingsGoals = computed(() => this.appState.savingsGoals());

  showForm = false;

  form = this.fb.group({
    name: ['', Validators.required],
    targetAmount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    currentAmount: [0, [Validators.required, Validators.min(0)]],
    accountName: ['', Validators.required],
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
    this.appState.addSavingsGoal({
      id: createId(),
      name: value.name ?? 'Goal',
      targetAmount: Number(value.targetAmount),
      currentAmount: Number(value.currentAmount),
      accountName: value.accountName ?? 'Savings',
      scope: (value.scope ?? 'shared') as Scope
    });

    this.toast.success(`Savings goal "${value.name}" created.`);

    this.form.reset({
      name: '',
      targetAmount: null,
      currentAmount: 0,
      accountName: '',
      scope: 'shared'
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

    const nextGoals = this.appState.savingsGoals().map((goal) => {
      if (goal.id !== goalId) {
        return goal;
      }

      return {
        ...goal,
        currentAmount: goal.currentAmount + amount
      };
    });

    this.appState.updateSavings(nextGoals);
    this.toast.success(`$${amount} contributed.`);
    this.contributionInput.set({
      ...this.contributionInput(),
      [goalId]: 0
    });
  }

  goalProgress(goalId: string): number {
    const goal = this.appState.savingsGoals().find((item) => item.id === goalId);
    if (!goal || goal.targetAmount <= 0) {
      return 0;
    }

    return Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
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
