export const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `id_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
};

export const createInviteCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    const random = Math.floor(Math.random() * alphabet.length);
    code += alphabet[random];
  }
  return code;
};

export const createInviteExpiry = (hours = 1): string => {
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  return expiresAt.toISOString();
};
