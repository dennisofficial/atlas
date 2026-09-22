export enum EAuthProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Inference = 'inference',
}

export enum EAuthKind {
  Oauth = 'oauth',
  ApiKey = 'api-key',
}

export enum EAccountOrigin {
  Login = 'login',
  Imported = 'imported',
  Environment = 'environment',
}

export enum EAccountStatus {
  Active = 'active',
  Limited = 'limited',
  Expired = 'expired',
}

export interface OauthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scopes?: string[]
  accountId?: string
}

export type AccountSecret =
  | { kind: EAuthKind.Oauth; tokens: OauthTokens }
  | { kind: EAuthKind.ApiKey; apiKey: string }

export interface AccountDto {
  id: string
  provider: string
  kind: string
  origin: string
  label: string
  status: string
  email?: string
  subscription?: string
  importedFrom?: string
  createdAt: string
  updatedAt: string
}

export interface StoredAccountDto extends AccountDto {
  secret: AccountSecret
}

export interface ActiveAccountDto {
  accountId: string | null
}

export interface AccessTokenDto {
  accessToken: string
  expiresAt: string | null
}

export interface ActiveAccountPointerDto {
  provider: string
  accountId: string
}

export interface SandboxAccountsDto {
  accounts: AccountDto[]
  active: ActiveAccountPointerDto[]
}

/**
 * The thread-scoped broker's mint answer: everything the serve process needs to build a
 * credential, and nothing more — the account's sealed secret (refresh token included) never
 * leaves the control plane.
 */
export interface SandboxAccessTokenDto {
  accountId: string
  kind: EAuthKind
  accessToken: string
  expiresAt: string | null
  providerAccountId?: string
}
