export enum EConnectionStatus {
  Active = 'active',
  Expired = 'expired',
}

export type StoredTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: string
  issuedAt: string
  scopes?: string[] | undefined
  accountId?: string | undefined
}

export type ProviderGrant = {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scopes?: string[] | undefined
  accountId?: string | undefined
}

export type ConnectionRow = {
  id: string
  userId: string
  provider: string
  status: string
  sealedTokens: string
  generation: number
  refreshAttempt: string | null
  refreshStartedAt: Date | null
}

export type AttemptFence = { id: string; attemptId: string; generation: number }

export type IssuedModelToken = {
  accessToken: string
  expiresAt: string
  refreshAfter: string
  generation: number
  providerAccountId?: string | undefined
}

export class ProviderRejectedError extends Error {}

export class ProviderRateLimitedError extends Error {}
