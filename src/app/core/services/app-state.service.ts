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
  FirestoreError,
  Unsubscribe,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { createId } from '../utils/id';
import { formatLocal, localDateToIso, resolveDayOfMonth, todayLocalDate } from '../utils/dates';
import { normalizeAmount } from '../utils/money';
import { ErrorReporterService } from './error-reporter.service';

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
  private readonly reporter = inject(ErrorReporterService);

  private readonly usersSignal = signal<User[]>([]);
  private readonly householdsSignal = signal<Household[]>([]);
  private readonly categoriesSignal = signal<BudgetCategory[]>([]);
  private readonly budgetsSignal = signal<Budget[]>([]);
  private readonly transactionsSignal = signal<Transaction[]>([]);
  private readonly savingsSignal = signal<SavingsGoal[]>([]);
  private readonly investmentsSignal = signal<InvestmentEntry[]>([]);
  private readonly invitesSignal = signal<Invite[]>([]);
  private readonly householdChangeRequestsSignal = signal<HouseholdChangeRequest[]>([]);
  private readonly recurringTemplatesSignal = signal<RecurringTemplate[]>([]);
  private readonly additionalIncomeSignal = signal<AdditionalIncomeEntry[]>([]);

  // Number of Firestore writes currently in flight, and whether the most recent
  // batch failed. Surfaced in the shell so users can trust what they see.
  private readonly pendingWriteCount = signal(0);
  private readonly lastWriteFailed = signal(false);
  // True once the first transactions snapshot for the active scope has arrived.
  // Lets pages show a loading state instead of a misleading "nothing here yet".
  private readonly transactionsLoadedSignal = signal(false);

  private initialized = false;

  private readonly authUidSignal = signal<string | null>(null);
  private readonly unsubscribers: Unsubscribe[] = [];
  private readonly householdUnsubscribers: Unsubscribe[] = [];
  // Target paths are captured at enqueue time and never re-derived during retry.
  // A join/leave during the retry window must not migrate the doc into the new
  // scope.
  private readonly pendingTransactionWrites = new Map<string, { paths: string[]; data: object }>();
  private syncErrorToastAt = 0;
  private householdTransactionsCache: Transaction[] = [];
  private personalFallbackTransactionsCache: Transaction[] = [];
  private watchedScopeKey: string | null = null;
  private recurringGenerationInFlight = false;
  // Tracks recurring keys generated in this session but not yet confirmed by a
  // Firestore snapshot. Prevents duplicate generation when onSnapshot fires with
  // partial state before all async setDoc writes have been applied to the cache.
  private readonly inflightRecurringKeys = new Set<string>();

  readonly users = computed(() => this.usersSignal());
  readonly households = computed(() => this.householdsSignal());
  readonly categories = computed(() => this.categoriesSignal());
  readonly budgets = computed(() => this.budgetsSignal());
  readonly transactions = computed(() => this.transactionsSignal());
  readonly savingsGoals = computed(() => this.savingsSignal());
  readonly investments = computed(() => this.investmentsSignal());
  readonly invites = computed(() => this.invitesSignal());
  readonly householdChangeRequests = computed(() => this.householdChangeRequestsSignal());
  readonly recurringTemplates = computed(() => this.recurringTemplatesSignal());
  readonly additionalIncome = computed(() => this.additionalIncomeSignal());
  readonly transactionsLoaded = computed(() => this.transactionsLoadedSignal());
  readonly syncStatus = computed<'saved' | 'saving' | 'error'>(() => {
    if (this.pendingWriteCount() > 0) {
      return 'saving';
    }
    return this.lastWriteFailed() || this.pendingTransactionWrites.size > 0 ? 'error' : 'saved';
  });

  constructor() {
    // Hydrate cached state synchronously so guards and components see the
    // last-known user immediately on reload, rather than an empty window while
    // Firebase auth resolves asynchronously (that window is what flashes the
    // onboarding screen). The auth callback re-hydrates and attaches live
    // watchers; on logout localStorage is cleared, so this can only surface the
    // current user's own data.
    this.loadFromLocalStorage();

    onAuthStateChanged(this.firebase.auth, (authUser) => {
      this.cleanupWatchers();
      if (!authUser) {
        this.authUidSignal.set(null);
        return;
      }

      this.authUidSignal.set(authUser.uid);
      this.loadFromLocalStorage();
      this.watchUser(authUser.uid);
      void this.flushPendingTransactionWrites();
    });
  }

  private loadFromLocalStorage(): void {
    this.usersSignal.set(this.storage.getItem(STORAGE_KEYS.users, []));
    this.householdsSignal.set(this.storage.getItem(STORAGE_KEYS.households, []));
    this.categoriesSignal.set(this.storage.getItem(STORAGE_KEYS.categories, []));
    this.budgetsSignal.set(this.storage.getItem(STORAGE_KEYS.budgets, []));
    this.transactionsSignal.set(this.storage.getItem(STORAGE_KEYS.transactions, []));
    this.savingsSignal.set(this.storage.getItem(STORAGE_KEYS.savings, []));
    this.investmentsSignal.set(this.storage.getItem(STORAGE_KEYS.investments, []));
    this.invitesSignal.set(this.storage.getItem(STORAGE_KEYS.invites, []));
    this.householdChangeRequestsSignal.set(this.storage.getItem(STORAGE_KEYS.householdChangeRequests, []));
    this.recurringTemplatesSignal.set(this.storage.getItem(STORAGE_KEYS.recurringTemplates, []));
    this.additionalIncomeSignal.set(this.storage.getItem(STORAGE_KEYS.additionalIncome, []));
    this.initialized = true;
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

  // Create a household and point its owner's user doc at it in a single atomic
  // batch, so the two can never diverge (a half-written create is exactly what
  // leaves a user "in" a household the rules don't recognise, denying reads and
  // writes). Signals update optimistically; the caller awaits the commit.
  async createHouseholdWithOwner(household: Household, owner: User): Promise<void> {
    this.householdsSignal.set([
      household,
      ...this.householdsSignal().filter((item) => item.id !== household.id)
    ]);
    this.storage.setItem(STORAGE_KEYS.households, this.householdsSignal());

    const nextUsers = this.usersSignal().some((item) => item.id === owner.id)
      ? this.usersSignal().map((item) => (item.id === owner.id ? owner : item))
      : [owner, ...this.usersSignal()];
    this.usersSignal.set(nextUsers);
    this.storage.setItem(STORAGE_KEYS.users, nextUsers);

    const batch = writeBatch(this.firebase.firestore);
    batch.set(
      doc(this.firebase.firestore, 'households', household.id),
      { ...this.toFirestoreData(household), updatedAt: serverTimestamp() },
      { merge: true }
    );
    batch.set(
      doc(this.firebase.firestore, 'users', owner.id),
      { ...this.toFirestoreData(owner), updatedAt: serverTimestamp() },
      { merge: true }
    );
    await batch.commit();
  }

  addCategory(category: BudgetCategory): void {
    const next = [category, ...this.categoriesSignal()];
    this.categoriesSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.categories, next);
    void this.upsertHouseholdDoc('categories', category.id, category);
  }

  updateCategories(categories: BudgetCategory[]): void {
    const changed = this.changedItems(this.categoriesSignal(), categories);
    this.categoriesSignal.set(categories);
    this.storage.setItem(STORAGE_KEYS.categories, categories);
    for (const category of changed) {
      void this.upsertHouseholdDoc('categories', category.id, category);
    }
  }

  updateCategory(category: BudgetCategory): void {
    this.updateCategories(this.categoriesSignal().map((item) => (item.id === category.id ? category : item)));
  }

  // Categories can only be removed when nothing references them, so historical
  // transactions never lose their label.
  categoryUsage(categoryId: string): { transactions: number; budgets: number; recurring: number } {
    return {
      transactions: this.transactionsSignal().filter((tx) => tx.categoryId === categoryId).length,
      budgets: this.budgetsSignal().filter((budget) => budget.categoryId === categoryId).length,
      recurring: this.recurringTemplatesSignal().filter((template) => template.categoryId === categoryId).length
    };
  }

  removeCategory(categoryId: string): boolean {
    const usage = this.categoryUsage(categoryId);
    if (usage.transactions > 0 || usage.budgets > 0 || usage.recurring > 0) {
      return false;
    }
    const next = this.categoriesSignal().filter((category) => category.id !== categoryId);
    this.categoriesSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.categories, next);
    void this.upsertHouseholdDoc('categories', categoryId, { deleted: true, deletedAt: new Date().toISOString() });
    return true;
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
    const changed = this.changedItems(this.budgetsSignal(), normalized);
    this.budgetsSignal.set(normalized);
    this.storage.setItem(STORAGE_KEYS.budgets, normalized);
    for (const budget of changed) {
      void this.upsertHouseholdDoc('budgets', budget.id, budget);
    }
  }

  updateBudget(budget: Budget): void {
    this.updateBudgets(this.budgetsSignal().map((item) => (item.id === budget.id ? budget : item)));
  }

  updateTransactions(transactions: Transaction[]): void {
    const normalized = transactions.map((transaction) => ({
      ...transaction,
      scope: this.resolveScope(transaction.scope)
    }));
    const changed = this.changedItems(this.transactionsSignal(), normalized);
    this.transactionsSignal.set(normalized);
    this.storage.setItem(STORAGE_KEYS.transactions, normalized);
    for (const transaction of changed) {
      void this.upsertTransactionDoc(transaction.id, transaction);
    }
  }

  updateTransaction(transaction: Transaction): void {
    this.updateTransactions(
      this.transactionsSignal().map((item) => (item.id === transaction.id ? transaction : item))
    );
  }

  updateSavings(goals: SavingsGoal[]): void {
    const normalized = goals.map((goal) => ({
      ...goal,
      scope: this.resolveScope(goal.scope)
    }));
    const changed = this.changedItems(this.savingsSignal(), normalized);
    this.savingsSignal.set(normalized);
    this.storage.setItem(STORAGE_KEYS.savings, normalized);
    for (const goal of changed) {
      void this.upsertHouseholdDoc('savings', goal.id, goal);
    }
  }

  updateSavingsGoal(goal: SavingsGoal): void {
    this.updateSavings(this.savingsSignal().map((item) => (item.id === goal.id ? goal : item)));
  }

  // Items whose serialized form differs from the current snapshot (or are new).
  // Bulk updates only write what actually changed instead of every document.
  private changedItems<T extends { id: string }>(current: T[], next: T[]): T[] {
    const byId = new Map(current.map((item) => [item.id, JSON.stringify(item)]));
    return next.filter((item) => byId.get(item.id) !== JSON.stringify(item));
  }

  addSavingsContribution(goalId: string, amount: number, paidByUserId?: string): boolean {
    const normalizedAmount = normalizeAmount(amount);
    if (normalizedAmount <= 0) {
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

    const nextGoals = this.savingsSignal().map((item) =>
      item.id === goalId
        ? {
            ...item,
            currentAmount: normalizeAmount(item.currentAmount + normalizedAmount)
          }
        : item
    );
    this.updateSavings(nextGoals);

    const categoryId = this.ensureSavingsCategoryId(goal.scope);
    const localDate = todayLocalDate();
    this.addTransaction({
      id: createId(),
      title: `Savings contribution: ${goal.name}`,
      amount: normalizedAmount,
      type: 'expense',
      categoryId,
      paidByUserId: userId,
      date: localDateToIso(localDate),
      localDate,
      scope: goal.scope,
      recurring: false,
      notes: `Added to ${goal.name}`
    });

    return true;
  }

  updateInvestments(entries: InvestmentEntry[]): void {
    const changed = this.changedItems(this.investmentsSignal(), entries);
    this.investmentsSignal.set(entries);
    this.storage.setItem(STORAGE_KEYS.investments, entries);
    for (const entry of changed) {
      void this.upsertHouseholdDoc('investments', entry.id, entry);
    }
  }

  updateInvestment(entry: InvestmentEntry): void {
    this.updateInvestments(this.investmentsSignal().map((item) => (item.id === entry.id ? entry : item)));
  }

  removeInvestment(entryId: string): void {
    const next = this.investmentsSignal().filter((entry) => entry.id !== entryId);
    this.investmentsSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.investments, next);
    void this.upsertHouseholdDoc('investments', entryId, { deleted: true, deletedAt: new Date().toISOString() });
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

  // Edit a series going forward. Already-generated transactions keep their
  // original values; only future generations pick up the change.
  updateRecurringTemplate(template: RecurringTemplate): void {
    const normalized: RecurringTemplate = { ...template, scope: this.resolveScope(template.scope) };
    const next = this.recurringTemplatesSignal().map((item) => (item.id === normalized.id ? normalized : item));
    this.recurringTemplatesSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.recurringTemplates, next);
    void this.upsertHouseholdDoc('recurringTemplates', normalized.id, normalized);
  }

  // Stop a recurring series. Already-generated transactions are real history and
  // are left untouched; only future auto-generation stops.
  deleteRecurringTemplate(templateId: string): void {
    const next = this.recurringTemplatesSignal().filter((template) => template.id !== templateId);
    this.recurringTemplatesSignal.set(next);
    this.storage.setItem(STORAGE_KEYS.recurringTemplates, next);
    void this.upsertHouseholdDoc('recurringTemplates', templateId, {
      active: false,
      deleted: true,
      deletedAt: new Date().toISOString()
    });
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
    // Combine keys already confirmed in Firestore (via signal) with keys generated
    // in this session but not yet confirmed (inflight). This prevents the race where
    // onSnapshot overwrites the signal with partial data and triggers a second run
    // that re-generates keys that were just written but haven't been read back yet.
    const existingKeys = new Set([
      ...this.transactionsSignal()
        .filter((transaction) => transaction.recurringKey)
        .map((transaction) => transaction.recurringKey as string),
      ...this.inflightRecurringKeys
    ]);

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
        const monthIndex = cursor.getMonth();
        const day = resolveDayOfMonth(year, monthIndex + 1, template.dayOfMonth);
        const dueDate = new Date(year, monthIndex, day, 12, 0, 0);
        if (dueDate <= today) {
          const monthOneIndexed = monthIndex + 1;
          const recurringKey = `${template.id}_${year}_${monthOneIndexed}`;
          if (!existingKeys.has(recurringKey)) {
            const localDate = formatLocal(dueDate);
            const transaction: Transaction = {
              id: createId(),
              title: template.title,
              amount: normalizeAmount(template.amount),
              type: template.type ?? 'expense',
              categoryId: template.categoryId,
              paidByUserId: template.paidByUserId,
              date: localDateToIso(localDate),
              localDate,
              scope: template.scope,
              recurring: true,
              recurringTemplateId: template.id,
              recurringKey
            };

            existingKeys.add(recurringKey);
            this.inflightRecurringKeys.add(recurringKey);
            this.addTransaction(transaction);
          }
        }

        cursor = new Date(year, monthIndex + 1, 1);
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

  // Income transactions still carry a category so they slot into the same
  // ledger; this seeds a shared "Income" bucket the first time it's needed.
  ensureIncomeCategoryId(scope: Scope): string {
    const existing = this.categoriesSignal().find((category) => category.name.trim().toLowerCase() === 'income');
    if (existing) {
      return existing.id;
    }

    const category: BudgetCategory = {
      id: createId(),
      name: 'Income',
      color: '#16a34a',
      icon: 'income',
      defaultScope: scope
    };
    this.addCategory(category);
    return category.id;
  }

  private onSnapshotError(source: string): (err: FirestoreError) => void {
    return (err) => {
      // Read-side snapshot errors are almost always transient: a permission
      // check that briefly fails while scopes switch (join/leave/reload) and
      // self-heals on the next snapshot. Log for diagnostics, but never show
      // the "failed to sync" toast here — that message is about *writes*, and
      // firing it on a read error is what made saved transactions look broken.
      this.reporter.captureException(err, { source });
    };
  }

  // Public so membership transitions can force a fresh scope evaluation right
  // after their Firestore writes resolve.
  async refreshDataScope(): Promise<void> {
    const uid = this.authUidSignal();
    if (!uid) {
      return;
    }
    this.switchDataScope(uid);
    await this.flushPendingTransactionWrites();
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
    }, this.onSnapshotError('watchUser'));

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
      }, this.onSnapshotError(`watchHouseholdMembers:${memberId}`));

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
    }, this.onSnapshotError('watchHousehold'));

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
      const raw = snapshot.docs
        .map((docRef) => ({ id: docRef.id, ...(docRef.data() as Omit<Transaction, 'id'>) }) as Transaction)
        .filter((item) => !(item as { deleted?: boolean }).deleted);
      // Any recurring key Firestore has confirmed can leave the inflight set
      for (const tx of raw) {
        if (tx.recurringKey) this.inflightRecurringKeys.delete(tx.recurringKey);
      }
      const next = this.purgeDuplicateRecurring(raw);
      this.transactionsSignal.set(next);
      this.storage.setItem(STORAGE_KEYS.transactions, next);
      this.transactionsLoadedSignal.set(true);
      void this.ensureRecurringUpToDate();
    }, this.onSnapshotError('watchPersonalTransactions'));

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
    }, this.onSnapshotError('watchScopedTransactions:household'));
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
    }, this.onSnapshotError('watchScopedTransactions:personal'));
    this.householdUnsubscribers.push(personalUnsub);
  }

  private publishScopedTransactions(): void {
    const raw = [...this.householdTransactionsCache];
    for (const transaction of this.personalFallbackTransactionsCache) {
      if (!raw.some((item) => item.id === transaction.id)) {
        raw.push(transaction);
      }
    }

    // Any recurring key confirmed in either path can leave the inflight set
    for (const tx of raw) {
      if (tx.recurringKey) this.inflightRecurringKeys.delete(tx.recurringKey);
    }
    const merged = this.purgeDuplicateRecurring(raw);
    this.transactionsSignal.set(merged);
    this.storage.setItem(STORAGE_KEYS.transactions, merged);
    this.transactionsLoadedSignal.set(true);
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
    }, this.onSnapshotError(`watchHouseholdCollection:${collectionName}`));

    this.householdUnsubscribers.push(unsub);
  }

  private switchDataScope(uid: string): void {
    const householdId = this.activeHouseholdId();
    const scopeKey = householdId ? `household:${householdId}` : `personal:${uid}`;
    if (this.watchedScopeKey === scopeKey) {
      return;
    }

    this.cleanupHouseholdWatchers();
    this.transactionsLoadedSignal.set(false);

    // When transitioning between scopes (not on first setup), wipe all in-memory
    // signals and their localStorage mirrors before loading the new scope's data.
    // This prevents stale recurring templates from a previous household or user
    // from being processed by ensureRecurringUpToDate() and generating phantom
    // transactions under the new context.
    if (this.watchedScopeKey !== null) {
      this.clearDataSignals();
    }

    this.watchedScopeKey = scopeKey;

    if (householdId) {
      this.watchHousehold(householdId);
      void this.flushPendingTransactionWrites();
      return;
    }

    this.watchPersonalCollections(uid);
    void this.flushPendingTransactionWrites();
  }

  private clearDataSignals(): void {
    this.categoriesSignal.set([]);
    this.budgetsSignal.set([]);
    this.transactionsSignal.set([]);
    this.savingsSignal.set([]);
    this.investmentsSignal.set([]);
    this.invitesSignal.set([]);
    this.householdChangeRequestsSignal.set([]);
    this.recurringTemplatesSignal.set([]);
    this.additionalIncomeSignal.set([]);
    this.inflightRecurringKeys.clear();
    this.storage.removeItem(STORAGE_KEYS.categories);
    this.storage.removeItem(STORAGE_KEYS.budgets);
    this.storage.removeItem(STORAGE_KEYS.transactions);
    this.storage.removeItem(STORAGE_KEYS.savings);
    this.storage.removeItem(STORAGE_KEYS.investments);
    this.storage.removeItem(STORAGE_KEYS.invites);
    this.storage.removeItem(STORAGE_KEYS.householdChangeRequests);
    this.storage.removeItem(STORAGE_KEYS.recurringTemplates);
    this.storage.removeItem(STORAGE_KEYS.additionalIncome);
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
    }, this.onSnapshotError(`watchUserCollection:${collectionName}`));

    this.householdUnsubscribers.push(unsub);
  }

  private async upsertUser(user: User): Promise<void> {
    const userRef = doc(this.firebase.firestore, 'users', user.id);
    await this.trackWrite(
      setDoc(userRef, {
        ...this.toFirestoreData(user),
        updatedAt: serverTimestamp()
      }, { merge: true }),
      'AppState.upsertUser'
    );
  }

  private async upsertHousehold(household: Household): Promise<void> {
    const householdRef = doc(this.firebase.firestore, 'households', household.id);
    await this.trackWrite(
      setDoc(householdRef, {
        ...this.toFirestoreData(household),
        updatedAt: serverTimestamp()
      }, { merge: true }),
      'AppState.upsertHousehold'
    );
  }

  private async upsertHouseholdDoc(collectionName: string, id: string, data: object): Promise<void> {
    const householdId = this.activeHouseholdId();
    const uid = this.authUidSignal();
    const path = householdId
      ? `households/${householdId}/${collectionName}`
      : uid
        ? `users/${uid}/${collectionName}`
        : null;
    if (!path) {
      return;
    }

    const ref = doc(this.firebase.firestore, path, id);
    await this.trackWrite(
      setDoc(ref, {
        ...this.toFirestoreData(data),
        updatedAt: serverTimestamp()
      }, { merge: true }),
      `AppState.upsert:${collectionName}`
    );
  }

  // Wraps a Firestore write so the shell can show saving / saved / failed.
  private async trackWrite(write: Promise<void>, source: string): Promise<void> {
    this.pendingWriteCount.update((n) => n + 1);
    try {
      await write;
      this.lastWriteFailed.set(false);
    } catch (error) {
      this.lastWriteFailed.set(true);
      this.reporter.captureException(error, { source });
      this.showSyncErrorToast();
    } finally {
      this.pendingWriteCount.update((n) => Math.max(0, n - 1));
    }
  }

  private async upsertTransactionDoc(id: string, data: object): Promise<void> {
    const uid = this.authUidSignal();
    if (!uid) {
      // No auth yet — capture the personal path; if a household is later active
      // we'll write to it on the flush, but only via a fresh addTransaction call.
      this.pendingTransactionWrites.set(id, { paths: [`users/__pending__/transactions/${id}`], data });
      return;
    }

    const householdId = this.activeHouseholdId();
    const paths: string[] = [];
    if (householdId) {
      paths.push(`households/${householdId}/transactions/${id}`);
    }
    paths.push(`users/${uid}/transactions/${id}`);

    await this.commitTransactionPaths(id, paths, data);
  }

  private async commitTransactionPaths(id: string, paths: string[], data: object): Promise<void> {
    const payload = {
      ...this.toFirestoreData(data),
      updatedAt: serverTimestamp()
    };

    this.pendingWriteCount.update((n) => n + 1);
    try {
      const batch = writeBatch(this.firebase.firestore);
      for (const path of paths) {
        batch.set(doc(this.firebase.firestore, path), payload, { merge: true });
      }
      await batch.commit();
      this.pendingTransactionWrites.delete(id);
      this.lastWriteFailed.set(false);
    } catch (error) {
      this.lastWriteFailed.set(true);
      this.pendingTransactionWrites.set(id, { paths, data });
      this.reporter.captureException(error, {
        source: 'AppState.commitTransactionPaths',
        transactionId: id,
        paths
      });
      this.showSyncErrorToast();
    } finally {
      this.pendingWriteCount.update((n) => Math.max(0, n - 1));
    }
  }

  private showSyncErrorToast(): void {
    const now = Date.now();
    if (now - this.syncErrorToastAt < 5_000) {
      return;
    }
    this.syncErrorToastAt = now;
    this.toast.error("Couldn't save your last change to the cloud yet — it's kept on this device and will retry automatically.");
  }

  private toFirestoreData(data: object): Record<string, unknown> {
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  }

  private async flushPendingTransactionWrites(): Promise<void> {
    const uid = this.authUidSignal();
    if (!uid || this.pendingTransactionWrites.size === 0) {
      return;
    }

    const entries = Array.from(this.pendingTransactionWrites.entries());
    this.pendingTransactionWrites.clear();

    for (const [id, entry] of entries) {
      // Entries enqueued before auth was known need their personal path patched
      // with the actual uid. Household paths are immutable across the retry —
      // we never re-derive activeHouseholdId() at flush time.
      const paths = entry.paths.map((p) => p.replace('users/__pending__/', `users/${uid}/`));
      await this.commitTransactionPaths(id, paths, entry.data);
    }
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

  /**
   * Removes duplicate recurring transactions from a snapshot result.
   *
   * Because of historical race conditions (now fixed), Firestore may contain
   * several transactions sharing the same recurringKey. We keep the first one
   * encountered (Firestore returns docs in a consistent order) and permanently
   * delete the extras. This runs on every snapshot so the database self-heals
   * without any one-off migration script.
   */
  private purgeDuplicateRecurring(transactions: Transaction[]): Transaction[] {
    const seen = new Set<string>();
    const keep: Transaction[] = [];
    const purge: string[] = [];

    for (const tx of transactions) {
      if (!tx.recurringKey) {
        keep.push(tx);
        continue;
      }
      if (seen.has(tx.recurringKey)) {
        purge.push(tx.id);
      } else {
        seen.add(tx.recurringKey);
        keep.push(tx);
      }
    }

    if (purge.length > 0) {
      const now = new Date().toISOString();
      for (const id of purge) {
        void this.upsertTransactionDoc(id, { deleted: true, deletedAt: now });
      }
    }

    return keep;
  }

  private cleanupWatchers(): void {
    this.cleanupHouseholdWatchers();
    this.watchedScopeKey = null;
    this.transactionsLoadedSignal.set(false);
    this.inflightRecurringKeys.clear();
    this.usersSignal.set([]);
    this.householdsSignal.set([]);
    this.categoriesSignal.set([]);
    this.budgetsSignal.set([]);
    this.transactionsSignal.set([]);
    this.savingsSignal.set([]);
    this.investmentsSignal.set([]);
    this.invitesSignal.set([]);
    this.householdChangeRequestsSignal.set([]);
    this.recurringTemplatesSignal.set([]);
    this.additionalIncomeSignal.set([]);
    this.storage.removeItem(STORAGE_KEYS.users);
    this.storage.removeItem(STORAGE_KEYS.households);
    this.storage.removeItem(STORAGE_KEYS.categories);
    this.storage.removeItem(STORAGE_KEYS.budgets);
    this.storage.removeItem(STORAGE_KEYS.transactions);
    this.storage.removeItem(STORAGE_KEYS.savings);
    this.storage.removeItem(STORAGE_KEYS.investments);
    this.storage.removeItem(STORAGE_KEYS.invites);
    this.storage.removeItem(STORAGE_KEYS.householdChangeRequests);
    this.storage.removeItem(STORAGE_KEYS.recurringTemplates);
    this.storage.removeItem(STORAGE_KEYS.additionalIncome);
    this.initialized = false;
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
