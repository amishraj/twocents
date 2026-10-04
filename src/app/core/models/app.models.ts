export type Period = 'weekly' | 'monthly';
export type Scope = 'personal' | 'shared';
// Money direction. Absent/undefined means 'expense' (all legacy rows are spend).
export type TransactionType = 'expense' | 'income';
export type HouseholdType = 'solo' | 'couple';
export type InviteStatus = 'pending' | 'accepted';
export type HouseholdChangeRequestStatus = 'pending' | 'approved' | 'rejected';
export type HouseholdRole = 'owner' | 'manager' | 'member';

export interface UserPreferences {
  currency: string;
  weekStartsOn: 0 | 1;
  onboarded: boolean;
  themeColor?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  incomeMonthly: number;
  householdId: string;
  preferences: UserPreferences;
  createdAt: string;
  deleted?: boolean;
  accountDeletion?: AccountDeletionState;
}

export interface HouseholdMember {
  userId: string;
  role: HouseholdRole;
  displayName: string;
  joinedAt: string;
}

export interface MembersByUidEntry {
  role: HouseholdRole;
  displayName: string;
  joinedAt: string;
}

export interface Household {
  id: string;
  name: string;
  type: HouseholdType;
  members: HouseholdMember[];
  // Denormalized membership map keyed by uid. Authoritative once the strict
  // (phase-E) Firestore rules are deployed; written alongside members[] today.
  membersByUid?: Record<string, MembersByUidEntry>;
  sharedBudgetEnabled: boolean;
  inviteCode: string;
  inviteCodeExpiresAt?: string;
  currency: string;
}

export interface BudgetCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
  defaultScope: Scope;
}

export interface Budget {
  id: string;
  categoryId: string;
  limit: number;
  period: Period;
  scope: Scope;
  ownerId: string;
  householdId: string;
}

export interface Transaction {
  id: string;
  title: string;
  amount: number;
  // Money direction. Absent = 'expense' for backward compatibility.
  type?: TransactionType;
  categoryId: string;
  paidByUserId: string;
  // Legacy ISO string. Derived from localDate on write; never the source of
  // truth for month bucketing. Use parseLocalDate(tx.localDate ?? coerceLegacy…)
  // when reading.
  date: string;
  // Canonical wall-clock date in YYYY-MM-DD. Source of truth for recurring
  // bucketing and monthly aggregation.
  localDate?: string;
  scope: Scope;
  recurring: boolean;
  recurringTemplateId?: string;
  recurringKey?: string;
  notes?: string;
}

export interface RecurringTemplate {
  id: string;
  title: string;
  amount: number;
  // Money direction of the generated transactions. Absent = 'expense'.
  type?: TransactionType;
  categoryId: string;
  paidByUserId: string;
  dayOfMonth: number;
  scope: Scope;
  startDate: string;
  active: boolean;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  accountName: string;
  dueDate?: string;
  scope: Scope;
}

export interface InvestmentEntry {
  id: string;
  label: string;
  amount: number;
  accountName: string;
  type: 'brokerage' | 'retirement' | 'crypto' | 'other';
}

export interface Invite {
  id: string;
  householdId: string;
  email: string;
  status: InviteStatus;
  sentAt: string;
}

export interface HouseholdChangeRequest {
  id: string;
  userId: string;
  fromHouseholdId: string;
  targetHouseholdId: string;
  status: HouseholdChangeRequestStatus;
  requestedAt: string;
  approvedByUserId?: string;
  decidedAt?: string;
}

export interface AdditionalIncomeEntry {
  id: string;
  userId: string;
  householdId: string;
  source: string;
  amount: number;
  date: string;
}

export interface AuthSession {
  userId: string;
  token: string;
  expiresAt: string;
  isAuthenticated: boolean;
}

export type AccountDeletionStatus = 'pending' | 'in_progress' | 'complete';

export interface AccountDeletionState {
  status: AccountDeletionStatus;
  cursorCollection?: string;
  cursorLastId?: string;
  startedAt: string;
  updatedAt: string;
}

export interface InviteCodeDoc {
  code: string;
  householdId: string;
  expiresAt: string;
  createdByUid: string;
  acceptedByUid?: string;
  acceptedAt?: string;
}
