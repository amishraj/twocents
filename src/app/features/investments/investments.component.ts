import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppStateService } from '../../core/services/app-state.service';
import { ToastService } from '../../shared/toast/toast.service';
import { createId } from '../../core/utils/id';

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './investments.component.html',
  styleUrl: './investments.component.scss'
})
export class InvestmentsComponent {
  private readonly fb = inject(FormBuilder);
  public appState = inject(AppStateService);
  private readonly toast = inject(ToastService);

  showForm = false;

  form = this.fb.group({
    label: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    accountName: ['', Validators.required],
    type: ['brokerage', Validators.required]
  });

  toggleForm(): void {
    this.showForm = !this.showForm;
  }

  addEntry(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.warning('Please fill in all required fields.');
      return;
    }

    const value = this.form.getRawValue();
    this.appState.addInvestment({
      id: createId(),
      label: value.label ?? 'Investment',
      amount: Number(value.amount),
      accountName: value.accountName ?? 'Account',
      type: (value.type ?? 'brokerage') as 'brokerage' | 'retirement' | 'crypto' | 'other'
    });

    this.toast.success(`Investment "${value.label}" added.`);

    this.form.reset({
      label: '',
      amount: null,
      accountName: '',
      type: 'brokerage'
    });
    this.showForm = false;
  }

  typeTone(type: 'brokerage' | 'retirement' | 'crypto' | 'other'): 'info' | 'success' | 'warning' | 'neutral' {
    if (type === 'retirement') {
      return 'success';
    }
    if (type === 'crypto') {
      return 'warning';
    }
    if (type === 'brokerage') {
      return 'info';
    }
    return 'neutral';
  }
}
