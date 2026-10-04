import { isPositiveAmount, normalizeAmount } from './money';

describe('money util', () => {
  it('rounds to cents', () => {
    expect(normalizeAmount(10.555)).toBe(10.56);
    expect(normalizeAmount(10.554)).toBe(10.55);
    expect(normalizeAmount('10.10')).toBe(10.1);
  });

  it('returns 0 for NaN / Infinity / non-numeric strings', () => {
    expect(normalizeAmount(Number.NaN)).toBe(0);
    expect(normalizeAmount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeAmount('abc')).toBe(0);
    expect(normalizeAmount(undefined)).toBe(0);
    expect(normalizeAmount(null)).toBe(0);
  });

  it('isPositiveAmount accepts > 0, rejects 0 / negative / invalid', () => {
    expect(isPositiveAmount(0.01)).toBe(true);
    expect(isPositiveAmount(0)).toBe(false);
    expect(isPositiveAmount(-1)).toBe(false);
    expect(isPositiveAmount('garbage')).toBe(false);
    expect(isPositiveAmount(Number.NaN)).toBe(false);
  });
});
