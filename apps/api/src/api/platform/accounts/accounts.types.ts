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

export interface OauthAuthority {
  url: string
  connectionId: string
  generation?: number
  refreshAfter?: string
  authorizationId?: string
  previousAuthorizationId?: string
}

export type AccountSecret =
  | { kind: EAuthKind.Oauth; tokens: OauthTokens; authority?: OauthAuthority }
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
