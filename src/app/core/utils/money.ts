// Round to cents. Rejects NaN/Infinity. Returns 0 for invalid input so callers
// can safely store it; validation of "must be > 0" stays at the form layer.
export const normalizeAmount = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.round(n * 100) / 100;
};

export const isPositiveAmount = (value: unknown): boolean => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0;
};
