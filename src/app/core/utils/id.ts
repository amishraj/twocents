export const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `id_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
};

// Crockford base32, avoids I/L/O/U so users can't confuse them when typing.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

// 16 chars × 30^16 ≈ 2^78 search space. Cryptographically random, not Math.random,
// so guessing is infeasible. The old 6-char Math.random() generator was both
// non-cryptographic AND too short.
export const createInviteCode = (): string => {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let code = '';
  for (let i = 0; i < bytes.length; i += 1) {
    code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return code;
};

export const createInviteExpiry = (hours = 1): string => {
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  return expiresAt.toISOString();
};
