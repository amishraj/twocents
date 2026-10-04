// Canonical local-date storage. Transactions store a 'YYYY-MM-DD' string
// captured in the user's wall-clock; ISO timestamps are derived for back-compat.
// Never use `iso.slice(0, 10)` to recover a local date — that corrupts values
// stored at noon-UTC for users east of UTC+12.

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const todayLocalDate = (): string => {
  const now = new Date();
  return formatLocal(now);
};

export const formatLocal = (date: Date): string => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Used only when a legacy callsite still expects an ISO timestamp. Constructs
// noon-local so DST transitions don't shift the day.
export const localDateToIso = (localDate: string): string => {
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return new Date().toISOString();
  }
  return new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0).toISOString();
};

export interface LocalDateParts {
  year: number;
  month: number; // 1-indexed
  day: number;
}

export const parseLocalDateParts = (localDate: string): LocalDateParts | null => {
  if (!localDate || !YMD.test(localDate)) {
    return null;
  }
  const [y, m, d] = localDate.split('-').map((part) => Number(part));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  return { year: y, month: m, day: d };
};

// Source of truth for recurring-key bucketing. Timezone-independent because it
// operates on the YYYY-MM-DD string the user typed.
export const localDateParts = parseLocalDateParts;

export const parseLocalDate = (localDate: string | null | undefined): Date | null => {
  if (!localDate) {
    return null;
  }
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return null;
  }
  const date = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Convert a legacy value (ISO timestamp or YYYY-MM-DD) into the canonical
// YYYY-MM-DD shape. For ISO inputs, derives the calendar date in *this device's*
// timezone via getFullYear/getMonth/getDate — the original input timezone is
// unrecoverable from an ISO timestamp alone.
export const coerceLegacyToLocalDate = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  if (YMD.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return formatLocal(date);
};

// Resolve the day-of-month against the actual month length, e.g. day 31 in
// February clamps to 28/29.
export const resolveDayOfMonth = (year: number, monthOneIndexed: number, dayOfMonth: number): number => {
  const lastDay = new Date(year, monthOneIndexed, 0).getDate();
  return Math.min(dayOfMonth, lastDay);
};

export const buildRecurringKey = (templateId: string, localDate: string): string | null => {
  const parts = parseLocalDateParts(localDate);
  if (!parts) {
    return null;
  }
  return `${templateId}_${parts.year}_${parts.month}`;
};
