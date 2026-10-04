import { Scope, Transaction } from '../models/app.models';
import { coerceLegacyToLocalDate } from './dates';
import { DateRange, containsDate } from './periods';

export type ScopeFilter = 'all' | Scope;
export type TypeFilter = 'all' | 'expense' | 'income';

// Canonical local date for a transaction. `localDate` is the source of truth;
// legacy rows only have the ISO `date` and are coerced in this device's zone.
export const txLocalDate = (tx: Pick<Transaction, 'localDate' | 'date'>): string =>
  tx.localDate ?? coerceLegacyToLocalDate(tx.date) ?? '';

export const isIncome = (tx: Pick<Transaction, 'type'>): boolean => tx.type === 'income';
export const isExpense = (tx: Pick<Transaction, 'type'>): boolean => tx.type !== 'income';

export const txInRange = (tx: Transaction, range: DateRange): boolean => containsDate(range, txLocalDate(tx));

export const matchesScope = (tx: Pick<Transaction, 'scope'>, filter: ScopeFilter): boolean =>
  filter === 'all' ? true : tx.scope === filter;

export const matchesType = (tx: Pick<Transaction, 'type'>, filter: TypeFilter): boolean => {
  if (filter === 'all') {
    return true;
  }
  return filter === 'income' ? isIncome(tx) : isExpense(tx);
};

export const sumAmounts = (list: Transaction[]): number =>
  Math.round(list.reduce((sum, tx) => sum + tx.amount, 0) * 100) / 100;

// Newest first; ties broken by title so ordering is stable across renders.
export const sortNewestFirst = (list: Transaction[]): Transaction[] =>
  list.slice().sort((a, b) => {
    const byDate = txLocalDate(b).localeCompare(txLocalDate(a));
    return byDate !== 0 ? byDate : a.title.localeCompare(b.title);
  });

export const sortOldestFirst = (list: Transaction[]): Transaction[] => sortNewestFirst(list).reverse();

export interface DayGroup {
  date: string;
  items: Transaction[];
  spent: number;
  received: number;
}

export const groupByDay = (list: Transaction[]): DayGroup[] => {
  const groups = new Map<string, Transaction[]>();
  for (const tx of sortNewestFirst(list)) {
    const key = txLocalDate(tx);
    const bucket = groups.get(key) ?? [];
    bucket.push(tx);
    groups.set(key, bucket);
  }
  return Array.from(groups.entries()).map(([date, items]) => ({
    date,
    items,
    spent: sumAmounts(items.filter(isExpense)),
    received: sumAmounts(items.filter(isIncome))
  }));
};
