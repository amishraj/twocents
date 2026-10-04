import {
  buildRecurringKey,
  coerceLegacyToLocalDate,
  formatLocal,
  localDateToIso,
  parseLocalDate,
  parseLocalDateParts,
  resolveDayOfMonth,
  todayLocalDate
} from './dates';

describe('dates util', () => {
  it('todayLocalDate returns a YYYY-MM-DD string in local time', () => {
    const today = todayLocalDate();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expected = formatLocal(new Date());
    expect(today).toBe(expected);
  });

  it('parseLocalDateParts rejects invalid input', () => {
    expect(parseLocalDateParts('')).toBeNull();
    expect(parseLocalDateParts('not-a-date')).toBeNull();
    expect(parseLocalDateParts('2026-13-01')).toBeNull();
    expect(parseLocalDateParts('2026-02-30')).toEqual({ year: 2026, month: 2, day: 30 });
  });

  it('parseLocalDate returns Date for valid input, null for invalid', () => {
    const d = parseLocalDate('2026-03-15');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2); // 0-indexed March
    expect(d!.getDate()).toBe(15);
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate('garbage')).toBeNull();
  });

  it('localDateToIso round-trips through coerceLegacyToLocalDate', () => {
    const original = '2026-04-10';
    const iso = localDateToIso(original);
    const back = coerceLegacyToLocalDate(iso);
    expect(back).toBe(original);
  });

  it('coerceLegacyToLocalDate preserves YYYY-MM-DD unchanged', () => {
    expect(coerceLegacyToLocalDate('2026-04-10')).toBe('2026-04-10');
  });

  it('coerceLegacyToLocalDate handles ISO strings via local getters', () => {
    // Whatever the host TZ is, this should produce a YYYY-MM-DD shape.
    const out = coerceLegacyToLocalDate('2026-04-10T12:00:00.000Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('resolveDayOfMonth clamps to month length', () => {
    expect(resolveDayOfMonth(2026, 2, 31)).toBe(28); // Feb 2026
    expect(resolveDayOfMonth(2024, 2, 31)).toBe(29); // Feb 2024 (leap)
    expect(resolveDayOfMonth(2026, 4, 31)).toBe(30); // April
    expect(resolveDayOfMonth(2026, 3, 15)).toBe(15);
  });

  it('buildRecurringKey produces a stable, timezone-independent key', () => {
    const key = buildRecurringKey('tpl_abc', '2026-04-10');
    expect(key).toBe('tpl_abc_2026_4');
    expect(buildRecurringKey('tpl_abc', 'garbage')).toBeNull();
  });
});
