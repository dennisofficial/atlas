export enum EOauthProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
}

export enum EConnectionStatus {
  Active = 'active',
  Expired = 'expired',
}

export interface ProviderTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scopes?: string[]
  accountId?: string
}

export interface StoredTokens extends ProviderTokens {
  issuedAt: string
}

export interface AccessTokenDto {
  accessToken: string
  expiresAt: string
  refreshAfter: string
  generation: number
  authorizationId: string
  providerAccountId?: string
}

export interface ConnectionRow {
  id: string
  userId: string
  provider: string
  status: string
  sealedTokens: string
  authorizationId: string
  generation: number
  refreshAttempt: string | null
  refreshStartedAt: Date | null
}

export interface AttemptFence {
  id: string
  attemptId: string
  generation: number
}

export abstract class OauthConnectionStore {
  abstract insert(row: { id: string; userId: string; provider: string; sealedTokens: string }): Promise<boolean>
  abstract reauthorize(args: {
    id: string
    userId: string
    authorizationId: string
    previousAuthorizationId: string
    sealedTokens: string
  }): Promise<boolean>
  abstract find(args: { id: string }): Promise<ConnectionRow | null>
  abstract claim(args: { id: string; userId: string; generation: number; attemptId: string; startedAt: Date }): Promise<boolean>
  abstract complete(args: AttemptFence & { sealedTokens: string }): Promise<boolean>
  abstract release(args: AttemptFence): Promise<boolean>
  abstract reject(args: AttemptFence): Promise<boolean>
  abstract ownedSandboxId(args: { userId: string; threadId: string }): Promise<string | null>
  abstract assign(args: { connectionId: string; sandboxId: string }): Promise<void>
  abstract isAssigned(args: { connectionId: string; sandboxId: string }): Promise<boolean>
  abstract remove(args: { id: string; userId: string }): Promise<boolean>
}

export abstract class OauthIssuer {
  abstract refresh(args: {
    provider: EOauthProvider
    refreshToken: string
    nowMs: number
  }): Promise<Omit<ProviderTokens, 'refreshToken'> & { refreshToken?: string }>
}

export abstract class OauthClock {
  abstract now(): number
  abstract sleep(ms: number): Promise<void>
}

export class OauthRejectedError extends Error {}

export class OauthRateLimitedError extends Error {}
