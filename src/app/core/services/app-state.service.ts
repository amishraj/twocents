import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AdditionalIncomeEntry,
  Budget,
  BudgetCategory,
  Household,
  HouseholdChangeRequest,
  Invite,
  InvestmentEntry,
  RecurringTemplate,
  SavingsGoal,
  Scope,
  Transaction,
  User
} from '../models/app.models';
import { FirebaseClientService } from './firebase-client.service';
import { StorageService } from './storage.service';
import { ToastService } from '../../shared/toast/toast.service';
import {
  CollectionReference,
  DocumentData,
  Unsubscribe,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { createId } from '../utils/id';

const STORAGE_KEYS = {
  users: 'bt_users',
  households: 'bt_households',
  categories: 'bt_categories',
  budgets: 'bt_budgets',
  transactions: 'bt_transactions',
  savings: 'bt_savings',
  investments: 'bt_investments',
  invites: 'bt_invites',
  householdChangeRequests: 'bt_household_change_requests',
  recurringTemplates: 'bt_recurring_templates',
  additionalIncome: 'bt_additional_income'
};

@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly storage = inject(StorageService);
  private readonly firebase = inject(FirebaseClientService);
  private readonly toast = inject(ToastService);

  private readonly usersSignal = signal<User[]>(this.storage.getItem(STORAGE_KEYS.users, []));
  private readonly householdsSignal = signal<Household[]>(this.storage.getItem(STORAGE_KEYS.households, []));
  private readonly categoriesSignal = signal<BudgetCategory[]>(this.storage.getItem(STORAGE_KEYS.categories, []));
  private readonly budgetsSignal = signal<Budget[]>(this.storage.getItem(STORAGE_KEYS.budgets, []));
  private readonly transactionsSignal = signal<Transaction[]>(this.storage.getItem(STORAGE_KEYS.transactions, []));
  private readonly savingsSignal = signal<SavingsGoal[]>(this.storage.getItem(STORAGE_KEYS.savings, []));
  private readonly investmentsSignal = signal<InvestmentEntry[]>(
    this.storage.getItem(STORAGE_KEYS.investments, [])
  );
  private readonly invitesSignal = signal<Invite[]>(this.storage.getItem(STORAGE_KEYS.invites, []));
  private readonly householdChangeRequestsSignal = signal<HouseholdChangeRequest[]>(
    this.storage.getItem(STORAGE_KEYS.householdChangeRequests, [])
  );
  private readonly recurringTemplatesSignal = signal<RecurringTemplate[]>(
    this.storage.getItem(STORAGE_KEYS.recurringTemplates, [])
  );
  private readonly additionalIncomeSignal = signal<AdditionalIncomeEntry[]>(
    this.storage.getItem(STORAGE_KEYS.additionalIncome, [])
  );

  private readonly authUidSignal = signal<string | null>(null);
  private readonly unsubscribers: Unsubscribe[] = [];
  private readonly householdUnsubscribers: Unsubscribe[] = [];
  private readonly pendingTransactionWrites = new Map<string, object>();
  private householdTransactionsCache: Transaction[] = [];
  private personalFallbackTransactionsCache: Transaction[] = [];
  private watchedScopeKey: string | null = null;
  private recurringGenerationInFlight = false;

  readonly users = computed(() => this.usersSignal());
  readonly households = computed(() => this.householdsSignal());
  readonly categories = computed(() =>
    this.categoriesSignal().filter((c) => c.name.toLowerCase() !== 'porn')
  );
  readonly budgets = computed(() => this.budgetsSignal());
  readonly transactions = computed(() => this.transactionsSignal());
  readonly savingsGoals = computed(() => this.savingsSignal());
  readonly investments = computed(() => this.investmentsSignal());
  readonly invites = computed(() => this.invitesSignal());
  readonly householdChangeRequests = computed(() => this.householdChangeRequestsSignal());
  readonly recurringTemplates = computed(() => this.recurringTemplatesSignal());
  readonly additionalIncome = computed(() => this.additionalIncomeSignal());

  constructor() {
    onAuthStateChanged(this.firebase.auth, (authUser) => {
      this.cleanupWatchers();
      if (!authUser) {
        this.authUidSignal.set(null);
        return;
      }

      this.authUidSignal.set(authUser.uid);
      this.watchUser(authUser.uid);
      void this.flushPendingTransactionWrites();
    });
  }

  updateUsers(users: User[]): void {
    this.usersSignal.set(users);
    this.storage.setItem(STORAGE_KEYS.users, users);
    const currentUid = this.authUidSignal() ?? this.firebase.auth.currentUser?.uid ?? null;
    if (!currentUid) {
      return;
    }

    const user = users.find((item) => item.id === currentUid);
    if (user) {
      void this.upsertUser(user);
    }
  }

  updateHouseholds(households: Household[]): void {
    this.householdsSignal.set(households);
    this.storage.setItem(STORAGE_KEYS.households, households);
    for (const household of households) {
      void this.upsertHousehold(household);
    }
  }

  addCategory(category: BudgetCategory): void {
    const next = [category, ...this.categoriesSignal()];
    this.categoriesSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.categories, next);
    void this.upsertHouseholdDoc('categories', category.id, category);
  }

  updateCategories(categories: BudgetCategory[]): void {
    this.categoriesSignal.set(categories);
    this.storage.setItem(STORAGE_KEYS.categories, categories);
    for (const category of categories) {
      void this.upsertHouseholdDoc('categories', category.id, category);
    }
  }

  addBudget(budget: Budget): void {
    const normalized: Budget = {
      ...budget,
      scope: this.resolveScope(budget.scope)
    };
    const next = [normalized, ...this.budgetsSignal()];
    this.budgetsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.budgets, next);
    void this.upsertHouseholdDoc('budgets', normalized.id, normalized);
  }

  addTransaction(transaction: Transaction): void {
    const normalized: Transaction = {
      ...transaction,
      scope: this.resolveScope(transaction.scope)
    };
    const next = [normalized, ...this.transactionsSignal()];
    this.transactionsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.transactions, next);
    void this.upsertTransactionDoc(normalized.id, normalized);
  }

  removeTransaction(transactionId: string): void {
    const next = this.transactionsSignal().filter((transaction) => transaction.id !== transactionId);
    this.transactionsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.transactions, next);
    void this.upsertTransactionDoc(transactionId, { deleted: true, deletedAt: new Date().toISOString() });
  }

  addSavingsGoal(goal: SavingsGoal): void {
    const normalized: SavingsGoal = {
      ...goal,
      scope: this.resolveScope(goal.scope)
    };
    const next = [normalized, ...this.savingsSignal()];
    this.savingsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.savings, next);
    void this.upsertHouseholdDoc('savings', normalized.id, normalized);
  }

  removeSavingsGoal(goalId: string): void {
    const next = this.savingsSignal().filter((goal) => goal.id !== goalId);
    this.savingsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.savings, next);
    void this.upsertHouseholdDoc('savings', goalId, { deleted: true, deletedAt: new Date().toISOString() });
  }

  addInvestment(entry: InvestmentEntry): void {
    const next = [entry, ...this.investmentsSignal()];
    this.investmentsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.investments, next);
    void this.upsertHouseholdDoc('investments', entry.id, entry);
  }

  removeBudget(budgetId: string): void {
    const next = this.budgetsSignal().filter((budget) => budget.id !== budgetId);
    this.budgetsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.budgets, next);
    void this.upsertHouseholdDoc('budgets', budgetId, { deleted: true, deletedAt: new Date().toISOString() });
  }

  updateBudgets(budgets: Budget[]): void {
    const normalized = budgets.map((budget) => ({
      ...budget,
      scope: this.resolveScope(budget.scope)
    }));
    this.budgetsSignal.set(normalized);
    this.storage.setItem(STORAGE_KEYS.budgets, normalized);
    for (const budget of normalized) {
      void this.upsertHouseholdDoc('budgets', budget.id, budget);
    }
  }

  updateTransactions(transactions: Transaction[]): void {
    const normalized = transactions.map((transaction) => ({
      ...transaction,
      scope: this.resolveScope(transaction.scope)
    }));
    this.transactionsSignal.set(normalized);
    this.storage.setItem(STORAGE_KEYS.transactions, normalized);
    for (const transaction of normalized) {
      void this.upsertTransactionDoc(transaction.id, transaction);
    }
  }

  updateSavings(goals: SavingsGoal[]): void {
    const normalized = goals.map((goal) => ({
      ...goal,
      scope: this.resolveScope(goal.scope)
    }));
    this.savingsSignal.set(normalized);
    this.storage.setItem(STORAGE_KEYS.savings, normalized);
    for (const goal of normalized) {
      void this.upsertHouseholdDoc('savings', goal.id, goal);
    }
  }

  addSavingsContribution(goalId: string, amount: number, paidByUserId?: string): boolean {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return false;
    }

    const goal = this.savingsSignal().find((item) => item.id === goalId);
    if (!goal) {
      return false;
    }

    const userId = paidByUserId?.trim() || this.authUidSignal() || '';
    if (!userId) {
      return false;
    }

    const normalizedAmount = Math.round(parsedAmount * 100) / 100;
    const nextGoals = this.savingsSignal().map((item) =>
      item.id === goalId
        ? {
            ...item,
            currentAmount: item.currentAmount + normalizedAmount
          }
        : item
    );
    this.updateSavings(nextGoals);

    const categoryId = this.ensureSavingsCategoryId(goal.scope);
    this.addTransaction({
      id: createId(),
      title: `Savings contribution: ${goal.name}`,
      amount: normalizedAmount,
      categoryId,
      paidByUserId: userId,
      date: new Date().toISOString(),
      scope: goal.scope,
      recurring: false,
      notes: `Added to ${goal.name}`
    });

    return true;
  }

  updateInvestments(entries: InvestmentEntry[]): void {
    this.investmentsSignal.set(entries);
    this.storage.setItem(STORAGE_KEYS.investments, entries);
    for (const entry of entries) {
      void this.upsertHouseholdDoc('investments', entry.id, entry);
    }
  }

  addInvite(invite: Invite): void {
    const next = [invite, ...this.invitesSignal()];
    this.invitesSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.invites, next);
    void this.upsertHouseholdDoc('invites', invite.id, invite);
  }

  removeInvite(inviteId: string): void {
    const next = this.invitesSignal().filter((invite) => invite.id !== inviteId);
    this.invitesSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.invites, next);
    void this.upsertHouseholdDoc('invites', inviteId, { deleted: true, deletedAt: new Date().toISOString() });
  }

  addHouseholdChangeRequest(request: HouseholdChangeRequest): void {
    const next = [request, ...this.householdChangeRequestsSignal()];
    this.householdChangeRequestsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.householdChangeRequests, next);
    void this.upsertHouseholdDoc('householdChangeRequests', request.id, request);
  }

  updateHouseholdChangeRequests(requests: HouseholdChangeRequest[]): void {
    this.householdChangeRequestsSignal.set(requests);
    this.storage.setItem(STORAGE_KEYS.householdChangeRequests, requests);
    for (const request of requests) {
      void this.upsertHouseholdDoc('householdChangeRequests', request.id, request);
    }
  }

  addRecurringTemplate(template: RecurringTemplate): void {
    const normalized: RecurringTemplate = {
      ...template,
      scope: this.resolveScope(template.scope)
    };
    const next = [normalized, ...this.recurringTemplatesSignal()];
    this.recurringTemplatesSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.recurringTemplates, next);
    void this.upsertHouseholdDoc('recurringTemplates', normalized.id, normalized);
  }

  addAdditionalIncome(entry: AdditionalIncomeEntry): void {
    const next = [entry, ...this.additionalIncomeSignal()];
    this.additionalIncomeSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.additionalIncome, next);
    void this.upsertHouseholdDoc('additionalIncome', entry.id, entry);
  }

  updateAdditionalIncomes(entries: AdditionalIncomeEntry[]): void {
    this.additionalIncomeSignal.set(entries);
    this.storage.setItem(STORAGE_KEYS.additionalIncome, entries);
  }

  deleteAdditionalIncome(entryId: string): void {
    const next = this.additionalIncomeSignal().filter((e) => e.id !== entryId);
    this.additionalIncomeSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.additionalIncome, next);
    void this.upsertHouseholdDoc('additionalIncome', entryId, { deleted: true });
  }

  async ensureRecurringUpToDate(): Promise<void> {
    if (this.recurringGenerationInFlight) {
      return;
    }

    this.recurringGenerationInFlight = true;
    const templates = this.recurringTemplatesSignal().filter((template) => template.active);
    const existingKeys = new Set(
      this.transactionsSignal()
        .filter((transaction) => transaction.recurringKey)
        .map((transaction) => transaction.recurringKey as string)
    );

    const today = new Date();
    for (const template of templates) {
      const start = new Date(template.startDate);
      if (Number.isNaN(start.getTime())) {
        continue;
      }

      let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const monthLimit = new Date(today.getFullYear(), today.getMonth(), 1);

      while (cursor <= monthLimit) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        const dueDate = this.resolveDueDate(year, month, template.dayOfMonth);
        if (dueDate <= today) {
          const recurringKey = `${template.id}_${year}_${month + 1}`;
          if (!existingKeys.has(recurringKey)) {
            const transaction: Transaction = {
              id: createId(),
              title: template.title,
              amount: template.amount,
              categoryId: template.categoryId,
              paidByUserId: template.paidByUserId,
              date: dueDate.toISOString(),
              scope: template.scope,
              recurring: true,
              recurringTemplateId: template.id,
              recurringKey
            };

            existingKeys.add(recurringKey);
            this.addTransaction(transaction);
          }
        }

        cursor = new Date(year, month + 1, 1);
      }
    }

    this.recurringGenerationInFlight = false;
  }

  categoryById(id: string): BudgetCategory | undefined {
    return this.categoriesSignal().find((category) => category.id === id);
  }

  userById(id: string): User | undefined {
    return this.usersSignal().find((user) => user.id === id);
  }

  householdById(id: string): Household | undefined {
    return this.householdsSignal().find((household) => household.id === id);
  }

  private activeHouseholdId(): string | null {
    const uid = this.authUidSignal();
    if (!uid) {
      return null;
    }

    const householdId = this.userById(uid)?.householdId;
    if (!householdId || householdId.trim().length === 0) {
      return null;
    }

    const household = this.householdById(householdId);
    if (!household) {
      return householdId;
    }

    return householdId;
  }

  private resolveScope(scope: 'personal' | 'shared'): 'personal' | 'shared' {
    if (scope === 'shared' && !this.activeHouseholdId()) {
      return 'personal';
    }

    return scope;
  }

  private ensureSavingsCategoryId(scope: Scope): string {
    const existing = this.categoriesSignal().find((category) => category.name.trim().toLowerCase() === 'savings');
    if (existing) {
      return existing.id;
    }

    const category: BudgetCategory = {
      id: createId(),
      name: 'Savings',
      color: '#10B981',
      icon: 'piggy',
      defaultScope: scope
    };
    this.addCategory(category);
    return category.id;
  }

  private watchUser(uid: string): void {
    const userDoc = doc(this.firebase.firestore, 'users', uid);
    const userUnsub = onSnapshot(userDoc, (snapshot) => {
      if (!snapshot.exists()) {
        return;
      }

      const data = snapshot.data() as User;
      const users = this.usersSignal().filter((item) => item.id !== uid);
      const nextUsers = [
        {
          ...data,
          id: uid
        },
        ...users
      ];
      this.usersSignal.set(nextUsers);
      this.storage.setItem(STORAGE_KEYS.users, nextUsers);

      this.switchDataScope(uid);
    });

    this.unsubscribers.push(userUnsub);
  }

  private watchHouseholdMembers(memberIds: string[]): void {
    for (const memberId of memberIds) {
      const userDoc = doc(this.firebase.firestore, 'users', memberId);
      const unsub = onSnapshot(userDoc, (snapshot) => {
        if (!snapshot.exists()) {
          return;
        }

        const data = snapshot.data() as User;
        const users = this.usersSignal().filter((item) => item.id !== memberId);
        const nextUsers = [
          {
            ...data,
            id: memberId
          },
          ...users
        ];
        this.usersSignal.set(nextUsers);
        this.storage.setItem(STORAGE_KEYS.users, nextUsers);
      });

      this.householdUnsubscribers.push(unsub);
    }
  }

  private watchHousehold(householdId: string): void {
    const householdDoc = doc(this.firebase.firestore, 'households', householdId);
    const householdUnsub = onSnapshot(householdDoc, (snapshot) => {
      if (!snapshot.exists()) {
        return;
      }

      const household = { ...(snapshot.data() as Household), id: snapshot.id };
      const next = [
        household,
        ...this.householdsSignal().filter((item) => item.id !== household.id)
      ];
      this.householdsSignal.set(next);
      this.storage.setItem(STORAGE_KEYS.households, next);

      this.watchHouseholdMembers(household.members.map(m => m.userId));

      const currentUid = this.authUidSignal();
      if (currentUid) {
        this.switchDataScope(currentUid);
      }
    });

    this.householdUnsubscribers.push(householdUnsub);

    this.watchHouseholdCollection<BudgetCategory>('categories', this.categoriesSignal, STORAGE_KEYS.categories, householdId);
    this.watchHouseholdCollection<Budget>('budgets', this.budgetsSignal, STORAGE_KEYS.budgets, householdId);
    this.watchScopedTransactions(householdId);
    this.watchHouseholdCollection<SavingsGoal>('savings', this.savingsSignal, STORAGE_KEYS.savings, householdId);
    this.watchHouseholdCollection<InvestmentEntry>('investments', this.investmentsSignal, STORAGE_KEYS.investments, householdId);
    this.watchHouseholdCollection<Invite>('invites', this.invitesSignal, STORAGE_KEYS.invites, householdId);
    this.watchHouseholdCollection<HouseholdChangeRequest>(
      'householdChangeRequests',
      this.householdChangeRequestsSignal,
      STORAGE_KEYS.householdChangeRequests,
      householdId
    );
    this.watchHouseholdCollection<RecurringTemplate>(
      'recurringTemplates',
      this.recurringTemplatesSignal,
      STORAGE_KEYS.recurringTemplates,
      householdId
    );
    this.watchHouseholdCollection<AdditionalIncomeEntry>(
      'additionalIncome',
      this.additionalIncomeSignal,
      STORAGE_KEYS.additionalIncome,
      householdId
    );

    void this.ensureRecurringUpToDate();
  }

  private watchPersonalTransactions(uid: string): void {
    const transactionsRef = collection(
      this.firebase.firestore,
      `users/${uid}/transactions`
    ) as CollectionReference<DocumentData>;

    const unsub = onSnapshot(transactionsRef, (snapshot) => {
      const next = snapshot.docs
        .map((docRef) => ({ id: docRef.id, ...(docRef.data() as Omit<Transaction, 'id'>) }) as Transaction)
        .filter((item) => !(item as { deleted?: boolean }).deleted);
      this.transactionsSignal.set(next);
      this.storage.setItem(STORAGE_KEYS.transactions, next);
      void this.ensureRecurringUpToDate();
    });

    this.householdUnsubscribers.push(unsub);
  }

  private watchScopedTransactions(householdId: string): void {
    this.householdTransactionsCache = [];
    this.personalFallbackTransactionsCache = [];

    const householdTransactionsRef = collection(
      this.firebase.firestore,
      `households/${householdId}/transactions`
    ) as CollectionReference<DocumentData>;

    const householdUnsub = onSnapshot(householdTransactionsRef, (snapshot) => {
      this.householdTransactionsCache = snapshot.docs
        .map((docRef) => ({ id: docRef.id, ...(docRef.data() as Omit<Transaction, 'id'>) }) as Transaction)
        .filter((item) => !(item as { deleted?: boolean }).deleted);
      this.publishScopedTransactions();
    });
    this.householdUnsubscribers.push(householdUnsub);

    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }

    const personalTransactionsRef = collection(
      this.firebase.firestore,
      `users/${uid}/transactions`
    ) as CollectionReference<DocumentData>;

    const personalUnsub = onSnapshot(personalTransactionsRef, (snapshot) => {
      this.personalFallbackTransactionsCache = snapshot.docs
        .map((docRef) => ({ id: docRef.id, ...(docRef.data() as Omit<Transaction, 'id'>) }) as Transaction)
        .filter((item) => !(item as { deleted?: boolean }).deleted);
      this.publishScopedTransactions();
    });
    this.householdUnsubscribers.push(personalUnsub);
  }

  private publishScopedTransactions(): void {
    const merged = [...this.householdTransactionsCache];
    for (const transaction of this.personalFallbackTransactionsCache) {
      if (!merged.some((item) => item.id === transaction.id)) {
        merged.push(transaction);
      }
    }

    this.transactionsSignal.set(merged);
    this.storage.setItem(STORAGE_KEYS.transactions, merged);
    void this.ensureRecurringUpToDate();
  }

  private watchHouseholdCollection<T extends { id: string }>(
    collectionName: string,
    targetSignal: { set: (value: T[]) => void },
    storageKey: string,
    householdId: string
  ): void {
    const collectionRef = collection(
      this.firebase.firestore,
      `households/${householdId}/${collectionName}`
    ) as CollectionReference<DocumentData>;
    const unsub = onSnapshot(collectionRef, (snapshot) => {
      const next = snapshot.docs
        .map((docRef) => ({ id: docRef.id, ...(docRef.data() as Omit<T, 'id'>) }) as T)
        .filter((item) => !(item as { deleted?: boolean }).deleted);
      targetSignal.set(next);
      this.storage.setItem(storageKey, next);
      if (collectionName === 'recurringTemplates' || collectionName === 'transactions') {
        void this.ensureRecurringUpToDate();
      }
    });

    this.householdUnsubscribers.push(unsub);
  }

  private switchDataScope(uid: string): void {
    const householdId = this.activeHouseholdId();
    const scopeKey = householdId ? `household:${householdId}` : `personal:${uid}`;
    if (this.watchedScopeKey === scopeKey) {
      return;
    }

    this.cleanupHouseholdWatchers();
    this.watchedScopeKey = scopeKey;

    if (householdId) {
      this.watchHousehold(householdId);
      void this.flushPendingTransactionWrites();
      return;
    }

    this.watchPersonalCollections(uid);
    void this.flushPendingTransactionWrites();
  }

  private watchPersonalCollections(uid: string): void {
    this.watchPersonalTransactions(uid);
    this.watchUserCollection<BudgetCategory>('categories', this.categoriesSignal, STORAGE_KEYS.categories, uid);
    this.watchUserCollection<Budget>('budgets', this.budgetsSignal, STORAGE_KEYS.budgets, uid);
    this.watchUserCollection<SavingsGoal>('savings', this.savingsSignal, STORAGE_KEYS.savings, uid);
    this.watchUserCollection<InvestmentEntry>('investments', this.investmentsSignal, STORAGE_KEYS.investments, uid);
    this.watchUserCollection<RecurringTemplate>('recurringTemplates', this.recurringTemplatesSignal, STORAGE_KEYS.recurringTemplates, uid);
    this.watchUserCollection<AdditionalIncomeEntry>('additionalIncome', this.additionalIncomeSignal, STORAGE_KEYS.additionalIncome, uid);
    void this.ensureRecurringUpToDate();
  }

  private watchUserCollection<T extends { id: string }>(
    collectionName: string,
    targetSignal: { set: (value: T[]) => void },
    storageKey: string,
    uid: string
  ): void {
    const collectionRef = collection(
      this.firebase.firestore,
      `users/${uid}/${collectionName}`
    ) as CollectionReference<DocumentData>;
    const unsub = onSnapshot(collectionRef, (snapshot) => {
      const next = snapshot.docs
        .map((docRef) => ({ id: docRef.id, ...(docRef.data() as Omit<T, 'id'>) }) as T)
        .filter((item) => !(item as { deleted?: boolean }).deleted);
      targetSignal.set(next);
      this.storage.setItem(storageKey, next);
      if (collectionName === 'recurringTemplates') {
        void this.ensureRecurringUpToDate();
      }
    });

    this.householdUnsubscribers.push(unsub);
  }

  private async upsertUser(user: User): Promise<void> {
    const userRef = doc(this.firebase.firestore, 'users', user.id);
    await setDoc(userRef, {
      ...this.toFirestoreData(user),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  private async upsertHousehold(household: Household): Promise<void> {
    const householdRef = doc(this.firebase.firestore, 'households', household.id);
    await setDoc(householdRef, {
      ...this.toFirestoreData(household),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  private async upsertHouseholdDoc(collectionName: string, id: string, data: object): Promise<void> {
    const householdId = this.activeHouseholdId();
    const uid = this.authUidSignal();

    if (householdId) {
      const ref = doc(this.firebase.firestore, `households/${householdId}/${collectionName}`, id);
      await setDoc(ref, {
        ...this.toFirestoreData(data),
        updatedAt: serverTimestamp()
      }, { merge: true });
      return;
    }

    if (uid) {
      const ref = doc(this.firebase.firestore, `users/${uid}/${collectionName}`, id);
      await setDoc(ref, {
        ...this.toFirestoreData(data),
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
  }

  private async upsertTransactionDoc(id: string, data: object): Promise<void> {
    const uid = this.authUidSignal();
    if (!uid) {
      this.pendingTransactionWrites.set(id, data);
      return;
    }

    const householdId = this.activeHouseholdId();
    const payload = {
      ...this.toFirestoreData(data),
      updatedAt: serverTimestamp()
    };

    const writes: Promise<void>[] = [];
    if (householdId) {
      const householdRef = doc(this.firebase.firestore, `households/${householdId}/transactions`, id);
      writes.push(setDoc(householdRef, payload, { merge: true }));
    }

    const userRef = doc(this.firebase.firestore, `users/${uid}/transactions`, id);
    writes.push(setDoc(userRef, payload, { merge: true }));

    const results = await Promise.allSettled(writes);
    const anySucceeded = results.some((result) => result.status === 'fulfilled');
    if (anySucceeded) {
      this.pendingTransactionWrites.delete(id);
      return;
    }

    this.pendingTransactionWrites.set(id, data);
    const firstError = results.find((result) => result.status === 'rejected');
    if (firstError && firstError.status === 'rejected') {
      console.error('[AppState] Transaction write failed for all paths', {
        transactionId: id,
        householdId,
        uid,
        error: firstError.reason
      });
      this.toast.error('Failed to sync transaction. Will retry on next connection.');
    }
  }

  private toFirestoreData(data: object): Record<string, unknown> {
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  }

  private async flushPendingTransactionWrites(): Promise<void> {
    if (!this.authUidSignal() || this.pendingTransactionWrites.size === 0) {
      return;
    }

    const entries = Array.from(this.pendingTransactionWrites.entries());
    this.pendingTransactionWrites.clear();

    for (const [id, data] of entries) {
      await this.upsertTransactionDoc(id, data);
    }
  }

  private resolveDueDate(year: number, month: number, dayOfMonth: number): Date {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const resolvedDay = Math.min(dayOfMonth, lastDay);
    return new Date(year, month, resolvedDay, 12, 0, 0);
  }

  async adminResetAllData(): Promise<void> {
    const now = new Date().toISOString();
    const writes: Promise<void>[] = [];

    for (const tx of this.transactionsSignal()) {
      writes.push(this.upsertTransactionDoc(tx.id, { deleted: true, deletedAt: now }));
    }
    for (const cat of this.categoriesSignal()) {
      writes.push(this.upsertHouseholdDoc('categories', cat.id, { deleted: true, deletedAt: now }));
    }
    for (const budget of this.budgetsSignal()) {
      writes.push(this.upsertHouseholdDoc('budgets', budget.id, { deleted: true, deletedAt: now }));
    }
    for (const goal of this.savingsSignal()) {
      writes.push(this.upsertHouseholdDoc('savings', goal.id, { deleted: true, deletedAt: now }));
    }
    for (const inv of this.investmentsSignal()) {
      writes.push(this.upsertHouseholdDoc('investments', inv.id, { deleted: true, deletedAt: now }));
    }
    for (const tmpl of this.recurringTemplatesSignal()) {
      writes.push(this.upsertHouseholdDoc('recurringTemplates', tmpl.id, { deleted: true, deletedAt: now }));
    }

    await Promise.allSettled(writes);

    this.transactionsSignal.set([]);
    this.categoriesSignal.set([]);
    this.budgetsSignal.set([]);
    this.savingsSignal.set([]);
    this.investmentsSignal.set([]);
    this.recurringTemplatesSignal.set([]);

    this.storage.setItem(STORAGE_KEYS.transactions, []);
    this.storage.setItem(STORAGE_KEYS.categories, []);
    this.storage.setItem(STORAGE_KEYS.budgets, []);
    this.storage.setItem(STORAGE_KEYS.savings, []);
    this.storage.setItem(STORAGE_KEYS.investments, []);
    this.storage.setItem(STORAGE_KEYS.recurringTemplates, []);
  }

  private cleanupWatchers(): void {
    this.cleanupHouseholdWatchers();
    this.watchedScopeKey = null;
    while (this.unsubscribers.length) {
      const unsub = this.unsubscribers.pop();
      if (unsub) {
        unsub();
      }
    }
  }

  private cleanupHouseholdWatchers(): void {
    while (this.householdUnsubscribers.length) {
      const unsub = this.householdUnsubscribers.pop();
      if (unsub) {
        unsub();
      }
    }
    this.householdTransactionsCache = [];
    this.personalFallbackTransactionsCache = [];
  }
}
