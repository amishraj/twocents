// Period math on canonical YYYY-MM-DD strings. Everything here is timezone
// independent: ranges are inclusive string bounds, and comparisons are plain
// string comparisons (valid because the format is zero-padded ISO order).
import { formatLocal, parseLocalDateParts, todayLocalDate } from './dates';

export interface DateRange {
  // Inclusive bounds, YYYY-MM-DD.
  start: string;
  end: string;
}

export type PeriodMode = 'week' | 'month' | 'custom';

const toDate = (localDate: string): Date => {
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return new Date();
  }
  return new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0);
};

export const addDays = (localDate: string, days: number): string => {
  const d = toDate(localDate);
  d.setDate(d.getDate() + days);
  return formatLocal(d);
};

export const addMonths = (localDate: string, months: number): string => {
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return localDate;
  }
  // Anchor on the 1st so month arithmetic never overflows (Jan 31 + 1 month).
  const d = new Date(parts.year, parts.month - 1 + months, 1, 12, 0, 0);
  return formatLocal(d);
};

export const startOfMonth = (localDate: string): string => {
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return localDate;
  }
  return `${parts.year}-${`${parts.month}`.padStart(2, '0')}-01`;
};

export const endOfMonth = (localDate: string): string => {
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return localDate;
  }
  const lastDay = new Date(parts.year, parts.month, 0).getDate();
  return `${parts.year}-${`${parts.month}`.padStart(2, '0')}-${`${lastDay}`.padStart(2, '0')}`;
};

export const monthRange = (anchor: string): DateRange => ({
  start: startOfMonth(anchor),
  end: endOfMonth(anchor)
});

// Calendar week containing `anchor`, starting on Sunday (0) or Monday (1).
export const weekRange = (anchor: string, weekStartsOn: 0 | 1 = 1): DateRange => {
  const d = toDate(anchor);
  const day = d.getDay();
  const offset = (day - weekStartsOn + 7) % 7;
  const start = addDays(anchor, -offset);
  return { start, end: addDays(start, 6) };
};

export const daysInRange = (range: DateRange): number => {
  const a = toDate(range.start).getTime();
  const b = toDate(range.end).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
};

// How many days of the range have happened (inclusive of today). 0 when the
// range is entirely in the future; the full length when it is in the past.
export const daysElapsed = (range: DateRange, today = todayLocalDate()): number => {
  if (today < range.start) {
    return 0;
  }
  const effectiveEnd = today < range.end ? today : range.end;
  return daysInRange({ start: range.start, end: effectiveEnd });
};

export const daysRemaining = (range: DateRange, today = todayLocalDate()): number => {
  if (today > range.end) {
    return 0;
  }
  const effectiveStart = today > range.start ? today : range.start;
  return daysInRange({ start: effectiveStart, end: range.end });
};

// The range of equal length that ends the day before `range` starts. For a
// calendar month this is the previous calendar month.
export const previousRange = (range: DateRange, mode: PeriodMode = 'custom'): DateRange => {
  if (mode === 'month' && range.start === startOfMonth(range.start) && range.end === endOfMonth(range.start)) {
    return monthRange(addMonths(range.start, -1));
  }
  const length = daysInRange(range);
  const end = addDays(range.start, -1);
  return { start: addDays(end, -(length - 1)), end };
};

export const containsDate = (range: DateRange, localDate: string): boolean =>
  localDate >= range.start && localDate <= range.end;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const monthLabel = (localDate: string): string => {
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return '';
  }
  return `${MONTHS_LONG[parts.month - 1]} ${parts.year}`;
};

// "Oct 4" or "Oct 4, 2025" when the year differs from the current one.
export const shortDate = (localDate: string, withYear = false): string => {
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return '';
  }
  const base = `${MONTHS[parts.month - 1]} ${parts.day}`;
  return withYear ? `${base}, ${parts.year}` : base;
};

export const rangeLabel = (range: DateRange): string => {
  if (range.start === startOfMonth(range.start) && range.end === endOfMonth(range.start)) {
    return monthLabel(range.start);
  }
  const a = parseLocalDateParts(range.start);
  const b = parseLocalDateParts(range.end);
  if (!a || !b) {
    return '';
  }
  const sameYear = a.year === b.year;
  const currentYear = new Date().getFullYear();
  const showYear = !sameYear || a.year !== currentYear;
  return `${shortDate(range.start, showYear && !sameYear)} – ${shortDate(range.end, showYear)}`;
};

// Friendly relative wording for list headers.
export const relativeDayLabel = (localDate: string, today = todayLocalDate()): string => {
  if (localDate === today) {
    return 'Today';
  }
  if (localDate === addDays(today, -1)) {
    return 'Yesterday';
  }
  if (localDate === addDays(today, 1)) {
    return 'Tomorrow';
  }
  const parts = parseLocalDateParts(localDate);
  const todayParts = parseLocalDateParts(today);
  if (!parts || !todayParts) {
    return localDate;
  }
  const d = toDate(localDate);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday}, ${shortDate(localDate, parts.year !== todayParts.year)}`;
};

// Every date in the range, oldest first.
export const eachDay = (range: DateRange): string[] => {
  const days: string[] = [];
  let cursor = range.start;
  let guard = 0;
  while (cursor <= range.end && guard < 1000) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
};
