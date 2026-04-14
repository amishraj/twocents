import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SplitwiseService, SplitwiseExpense, SplitwiseMapping } from '../../core/services/splitwise.service';
import { AppStateService } from '../../core/services/app-state.service';
import { createId } from '../../core/utils/id';
import { BudgetCategory } from '../../core/models/app.models';

interface ExpenseRow {
  expense: SplitwiseExpense;
  selected: boolean;
  categoryId: string;
  amount: number;
}

@Component({
  selector: 'app-splitwise-review',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './splitwise-review.component.html',
  styleUrl: './splitwise-review.component.scss'
})
export class SplitwiseReviewComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly splitwise = inject(SplitwiseService);
  private readonly appState = inject(AppStateService);

  readonly expenses = this.splitwise.expenses;
  readonly categories = computed(() => this.appState.categories());
  readonly groups = this.splitwise.groups;
  readonly loading = signal(false);
  readonly imported = signal(0);

  rows = signal<ExpenseRow[]>([]);
  selectAll = signal(true);
  selectedCount = computed(() => this.rows().filter(r => r.selected).length);
  i = 0;

  trackRow(index: number): number {
    return index;
  }

  ngOnInit(): void {
    const stored = this.expenses();
    if (!stored.length) {
      this.router.navigate(['/splitwise']);
      return;
    }

    this.rows.set(
      stored.map((expense) => ({
        expense,
        selected: true,
        categoryId: this.guessCategory(expense),
        amount: this.calculateAmount(expense)
      }))
    );
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

    if (share) {
      return parseFloat(share.paid_share);
    }

    return parseFloat(expense.cost);
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
    const twoCentsCategories = this.categories();

    for (const row of selectedRows) {
      const category = twoCentsCategories.find((c) => c.id === row.categoryId);

      const transaction = {
        id: createId(),
        title: row.expense.description,
        amount: row.amount,
        categoryId: row.categoryId,
        paidByUserId: '',
        date: row.expense.date.split('T')[0],
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