import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { InvestmentEntry } from '../../core/models/app.models';
import { AppStateService } from '../../core/services/app-state.service';
import { CurrencyService } from '../../core/services/currency.service';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ToastService } from '../../shared/toast/toast.service';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';
import { SheetComponent } from '../../shared/sheet/sheet.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { createId } from '../../core/utils/id';
import { isPositiveAmount, normalizeAmount } from '../../core/utils/money';

type InvestmentType = InvestmentEntry['type'];

const TYPE_LABEL: Record<InvestmentType, string> = {
  brokerage: 'Brokerage',
  retirement: 'Retirement',
  crypto: 'Crypto',
  other: 'Other'
};

const TYPE_COLOR: Record<InvestmentType, string> = {
  brokerage: '#2563eb',
  retirement: '#059669',
  crypto: '#d97706',
  other: '#64748b'
};

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [DecimalPipe, ReactiveFormsModule, MoneyPipe, ConfirmModalComponent, SheetComponent, IconComponent],
  templateUrl: './investments.component.html',
  styleUrl: './investments.component.scss'
})
export class InvestmentsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  readonly appState = inject(AppStateService);
  readonly currency = inject(CurrencyService);

  readonly editing = signal<InvestmentEntry | null>(null);
  readonly creating = signal(false);
  readonly confirmDeleteId = signal<string | null>(null);

  readonly typeLabel = TYPE_LABEL;
  readonly typeColor = TYPE_COLOR;
  readonly types: InvestmentType[] = ['brokerage', 'retirement', 'crypto', 'other'];

  readonly entries = computed(() => this.appState.investments().slice().sort((a, b) => b.amount - a.amount));
  readonly total = computed(() => this.entries().reduce((sum, e) => sum + e.amount, 0));
  readonly byType = computed(() => {
    const total = this.total();
    return this.types
      .map((type) => {
        const amount = this.entries().filter((e) => e.type === type).reduce((sum, e) => sum + e.amount, 0);
        return { type, amount, share: total > 0 ? amount / total : 0 };
      })
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  });

  form = this.fb.group({
    label: ['', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    accountName: [''],
    type: ['brokerage' as InvestmentType, Validators.required]
  });

  openCreate(): void {
    this.editing.set(null);
    this.form.reset({ label: '', amount: null, accountName: '', type: 'brokerage' });
    this.creating.set(true);
  }

  openEdit(entry: InvestmentEntry): void {
    this.creating.set(false);
    this.editing.set(entry);
    this.form.reset({ label: entry.label, amount: entry.amount, accountName: entry.accountName, type: entry.type });
  }

  closeForm(): void {
    this.creating.set(false);
    this.editing.set(null);
  }

  save(): void {
    const value = this.form.getRawValue();
    if (!(value.label ?? '').trim() || !isPositiveAmount(value.amount)) {
      this.form.markAllAsTouched();
      this.toast.warning('Give the holding a name and a value above zero.');
      return;
    }
    const next: InvestmentEntry = {
      id: this.editing()?.id ?? createId(),
      label: (value.label ?? '').trim(),
      amount: normalizeAmount(value.amount),
      accountName: (value.accountName ?? '').trim(),
      type: (value.type ?? 'other') as InvestmentType
    };
    if (this.editing()) {
      this.appState.updateInvestment(next);
      this.toast.success('Holding updated.');
    } else {
      this.appState.addInvestment(next);
      this.toast.success(`"${next.label}" added.`);
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
    this.appState.removeInvestment(id);
    this.confirmDeleteId.set(null);
    if (this.editing()?.id === id) {
      this.closeForm();
    }
    this.toast.success('Holding removed.');
  }
}
