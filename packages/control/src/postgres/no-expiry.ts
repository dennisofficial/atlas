export const NO_EXPIRY_AT = new Date('9999-12-31T23:59:59.999Z')

export const expiryInstantOf = (expiresAt: string | null): Date =>
  expiresAt === null ? NO_EXPIRY_AT : new Date(expiresAt)

export const expiresAtOf = (stored: Date): string | null =>
  stored.getTime() >= NO_EXPIRY_AT.getTime() ? null : stored.toISOString()
