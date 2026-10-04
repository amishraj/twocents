import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SplitwiseService, SplitwiseExpense, SplitwiseMapping } from '../../core/services/splitwise.service';
import { AppStateService } from '../../core/services/app-state.service';
import { AuthService } from '../../core/services/auth.service';
import { createId } from '../../core/utils/id';
import { coerceLegacyToLocalDate, localDateToIso, todayLocalDate } from '../../core/utils/dates';
import { normalizeAmount } from '../../core/utils/money';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { IconComponent } from '../../shared/icon/icon.component';

interface ExpenseRow {
  expense: SplitwiseExpense;
  selected: boolean;
  categoryId: string;
  amount: number;
}

@Component({
  selector: 'app-splitwise-review',
  standalone: true,
  imports: [DatePipe, FormsModule, MoneyPipe, IconComponent],
  templateUrl: './splitwise-review.component.html',
  styleUrl: './splitwise-review.component.scss'
})
export class SplitwiseReviewComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly splitwise = inject(SplitwiseService);
  private readonly appState = inject(AppStateService);
  private readonly auth = inject(AuthService);

  readonly expenses = this.splitwise.expenses;
  readonly categories = computed(() => this.appState.categories());
  readonly groups = this.splitwise.groups;
  readonly loading = signal(false);
  readonly imported = signal(0);

  rows = signal<ExpenseRow[]>([]);
  selectAll = signal(true);
  selectedCount = computed(() => this.rows().filter((r) => r.selected).length);
  selectedTotal = computed(() =>
    Math.round(this.rows().filter((r) => r.selected).reduce((sum, r) => sum + r.amount, 0) * 100) / 100
  );

  ngOnInit(): void {
    const stored = this.expenses();
    if (!stored.length) {
      this.router.navigate(['/splitwise']);
      return;
    }

    // Settle-up payments are money transfers, not spending; already-imported
    // expenses would double-count if re-imported.
    const alreadyImported = this.importedSplitwiseIds();
    this.rows.set(
      stored
        .filter((expense) => !expense.payment)
        .filter((expense) => !alreadyImported.has(expense.id))
        .map((expense) => ({
          expense,
          selected: true,
          categoryId: this.guessCategory(expense),
          amount: this.calculateAmount(expense)
        }))
    );
  }

  private importedSplitwiseIds(): Set<number> {
    const ids = new Set<number>();
    for (const tx of this.appState.transactions()) {
      const match = tx.notes?.match(/Imported from Splitwise #(\d+)/);
      if (match) {
        ids.add(Number(match[1]));
      }
    }
    return ids;
  }

  toggleAll(): void {
    const newValue = !this.selectAll();
    this.selectAll.set(newValue);
    this.rows.update((rows) => rows.map((r) => ({ ...r, selected: newValue })));
  }

  toggleRow(index: number): void {
    this.rows.update((rows) => {
      const newRows = [...rows];
      newRows[index] = { ...newRows[index], selected: !newRows[index].selected };
      return newRows;
    });
    this.selectAll.set(this.rows().every((r) => r.selected));
  }

  setCategory(index: number, categoryId: string): void {
    this.rows.update((rows) => {
      const newRows = [...rows];
      newRows[index] = { ...newRows[index], categoryId };
      return newRows;
    });

    const expense = this.rows()[index].expense;
    this.saveMapping(expense.category.id, expense.category.name, categoryId);
  }

  private guessCategory(expense: SplitwiseExpense): string {
    const mapped = this.splitwise.getTwoCentsCategoryMapping(
      expense.category.id,
      expense.category.name
    );
    if (mapped) {
      return mapped;
    }

    const swCategoryName = expense.category.name.toLowerCase();
    const twoCentsCategories = this.categories();

    for (const cat of twoCentsCategories) {
      const tcName = cat.name.toLowerCase();
      if (swCategoryName.includes(tcName) || tcName.includes(swCategoryName)) {
        return cat.id;
      }
    }

    return twoCentsCategories[0]?.id ?? '';
  }

  private calculateAmount(expense: SplitwiseExpense): number {
    const currentUserId = this.splitwise.connection()?.splitwiseUserId;
    const share = expense.users.find((u) => u.user_id === currentUserId);

    // The user's real cost is their owed share of the bill — not what they
    // physically paid (paid_share is 0 when someone else covered the bill,
    // and the full amount when they fronted it for the group).
    if (share) {
      return normalizeAmount(parseFloat(share.owed_share));
    }

    return normalizeAmount(parseFloat(expense.cost));
  }

  private saveMapping(
    swCategoryId: number,
    swCategoryName: string,
    twoCentsCategoryId: string
  ): void {
    const mapping: SplitwiseMapping = {
      splitwiseCategoryId: swCategoryId,
      splitwiseCategoryName: swCategoryName,
      twoCentsCategoryId
    };
    this.splitwise.saveMapping(mapping);
  }

  getSource(expense: SplitwiseExpense): string {
    if (expense.group_id && expense.group_id > 0) {
      const group = this.groups().find((g) => g.id === expense.group_id);
      return group?.name ?? 'Group';
    }
    return 'Direct';
  }

  async importSelected(): Promise<void> {
    this.loading.set(true);

    const selectedRows = this.rows().filter((r) => r.selected);
    const activeUserId = this.auth.getActiveUser()?.id ?? '';

    for (const row of selectedRows) {
      const localDate = coerceLegacyToLocalDate(row.expense.date) ?? todayLocalDate();
      const transaction = {
        id: createId(),
        title: row.expense.description,
        amount: normalizeAmount(row.amount),
        type: 'expense' as const,
        categoryId: row.categoryId,
        paidByUserId: activeUserId,
        date: localDateToIso(localDate),
        localDate,
        scope: 'personal' as const,
        recurring: false,
        notes: `Imported from Splitwise #${row.expense.id}`
      };

      this.appState.addTransaction(transaction);
    }

    this.imported.set(selectedRows.length);
    this.loading.set(false);

    setTimeout(() => {
      this.router.navigate(['/splitwise']);
    }, 1500);
  }

  goBack(): void {
    this.router.navigate(['/splitwise']);
  }
}