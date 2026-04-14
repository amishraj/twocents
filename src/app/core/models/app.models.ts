export type Period = 'weekly' | 'monthly';
export type Scope = 'personal' | 'shared';
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
}

export interface HouseholdMember {
  userId: string;
  role: HouseholdRole;
  displayName: string;
  joinedAt: string;
}

export interface Household {
  id: string;
  name: string;
  type: HouseholdType;
  members: HouseholdMember[];
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
  categoryId: string;
  paidByUserId: string;
  date: string;
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
