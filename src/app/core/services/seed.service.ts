import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';
import {
  Budget,
  BudgetCategory,
  Household,
  InvestmentEntry,
  SavingsGoal,
  Transaction,
  User
} from '../models/app.models';
import { createId, createInviteCode } from '../utils/id';

const STORAGE_KEYS = {
  users: 'bt_users',
  households: 'bt_households',
  categories: 'bt_categories',
  budgets: 'bt_budgets',
  transactions: 'bt_transactions',
  savings: 'bt_savings',
  investments: 'bt_investments',
  invites: 'bt_invites',
  householdChangeRequests: 'bt_household_change_requests'
};

@Injectable({ providedIn: 'root' })
export class SeedService {
  constructor(private storage: StorageService) {}

  ensureSeeded(): void {
    if (this.storage.hasItem(STORAGE_KEYS.users)) {
      return;
    }

    const householdId = createId();
    const userId = createId();
    const now = new Date().toISOString();

    const users: User[] = [
      {
        id: userId,
        name: 'Avery',
        email: 'demo@budget.app',
        incomeMonthly: 7200,
        householdId,
        preferences: {
          currency: 'USD',
          weekStartsOn: 1,
          onboarded: true
        },
        createdAt: now
      }
    ];

    const households: Household[] = [
      {
        id: householdId,
        name: 'Avery + Jordan',
        type: 'couple',
        members: [
          {
            userId,
            role: 'owner',
            displayName: 'Avery',
            joinedAt: now
          }
        ],
        sharedBudgetEnabled: true,
        inviteCode: createInviteCode(),
        currency: 'USD'
      }
    ];

    const categories: BudgetCategory[] = [
      { id: createId(), name: 'Essentials', color: '#D97706', icon: 'bag', defaultScope: 'shared' },
      { id: createId(), name: 'Groceries', color: '#059669', icon: 'cart', defaultScope: 'shared' },
      { id: createId(), name: 'Dining', color: '#0EA5E9', icon: 'utensils', defaultScope: 'shared' },
      { id: createId(), name: 'Entertainment', color: '#F97316', icon: 'ticket', defaultScope: 'personal' },
      { id: createId(), name: 'Wellness', color: '#8B5CF6', icon: 'heart', defaultScope: 'personal' },
      { id: createId(), name: 'Savings', color: '#10B981', icon: 'piggy', defaultScope: 'shared' }
    ];

    const categoryMap = new Map(categories.map((cat) => [cat.name, cat.id]));

    const budgets: Budget[] = [
      {
        id: createId(),
        categoryId: categoryMap.get('Essentials')!,
        limit: 1200,
        period: 'monthly',
        scope: 'shared',
        ownerId: userId,
        householdId
      },
      {
        id: createId(),
        categoryId: categoryMap.get('Groceries')!,
        limit: 650,
        period: 'monthly',
        scope: 'shared',
        ownerId: userId,
        householdId
      },
      {
        id: createId(),
        categoryId: categoryMap.get('Dining')!,
        limit: 320,
        period: 'monthly',
        scope: 'shared',
        ownerId: userId,
        householdId
      },
      {
        id: createId(),
        categoryId: categoryMap.get('Entertainment')!,
        limit: 220,
        period: 'monthly',
        scope: 'personal',
        ownerId: userId,
        householdId
      }
    ];

    const nowDate = new Date();
    const recentDates = Array.from({ length: 10 }).map((_, index) => {
      const date = new Date(nowDate);
      date.setDate(nowDate.getDate() - index);
      return date.toISOString();
    });

    const transactions: Transaction[] = [
      {
        id: createId(),
        title: "Trader Joe's",
        amount: 86.5,
        categoryId: categoryMap.get('Groceries')!,
        paidByUserId: userId,
        date: recentDates[0],
        scope: 'shared',
        recurring: false
      },
      {
        id: createId(),
        title: 'Target run',
        amount: 54.2,
        categoryId: categoryMap.get('Essentials')!,
        paidByUserId: userId,
        date: recentDates[1],
        scope: 'shared',
        recurring: false
      },
      {
        id: createId(),
        title: 'Sushi night',
        amount: 62.9,
        categoryId: categoryMap.get('Dining')!,
        paidByUserId: userId,
        date: recentDates[2],
        scope: 'shared',
        recurring: false
      },
      {
        id: createId(),
        title: 'Movie tickets',
        amount: 28,
        categoryId: categoryMap.get('Entertainment')!,
        paidByUserId: userId,
        date: recentDates[3],
        scope: 'personal',
        recurring: false
      },
      {
        id: createId(),
        title: 'Yoga class',
        amount: 35,
        categoryId: categoryMap.get('Wellness')!,
        paidByUserId: userId,
        date: recentDates[4],
        scope: 'personal',
        recurring: false
      }
    ];

    const savings: SavingsGoal[] = [
      {
        id: createId(),
        name: 'Summer Trip',
        targetAmount: 2500,
        currentAmount: 1180,
        accountName: 'Ally Savings',
        dueDate: new Date(nowDate.getFullYear(), nowDate.getMonth() + 4, 1).toISOString(),
        scope: 'shared'
      },
      {
        id: createId(),
        name: 'Emergency Fund',
        targetAmount: 12000,
        currentAmount: 6800,
        accountName: 'Household Savings',
        scope: 'shared'
      }
    ];

    const investments: InvestmentEntry[] = [
      {
        id: createId(),
        label: 'Vanguard Index',
        amount: 14250,
        accountName: 'Brokerage',
        type: 'brokerage'
      },
      {
        id: createId(),
        label: 'Roth IRA',
        amount: 8600,
        accountName: 'Retirement',
        type: 'retirement'
      }
    ];

    const invites = [
      {
        id: createId(),
        householdId,
        email: 'partner@example.com',
        status: 'pending' as const,
        sentAt: now
      }
    ];

    this.storage.setItem(STORAGE_KEYS.users, users);
    this.storage.setItem(STORAGE_KEYS.households, households);
    this.storage.setItem(STORAGE_KEYS.categories, categories);
    this.storage.setItem(STORAGE_KEYS.budgets, budgets);
    this.storage.setItem(STORAGE_KEYS.transactions, transactions);
    this.storage.setItem(STORAGE_KEYS.savings, savings);
    this.storage.setItem(STORAGE_KEYS.investments, investments);
    this.storage.setItem(STORAGE_KEYS.invites, invites);
    this.storage.setItem(STORAGE_KEYS.householdChangeRequests, []);
  }
}
