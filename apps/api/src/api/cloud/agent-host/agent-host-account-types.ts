import type { EAuthKind } from '@dltech/atlas-core'

export type StoredAccountDto = {
  id: string
  provider: string
  kind: string
  origin: string
  label: string
  status: string
  email?: string | undefined
  subscription?: string | undefined
  importedFrom?: string | undefined
  secretVersion?: number | undefined
  createdAt: string
  updatedAt: string
  secret:
    | {
        kind: EAuthKind.Oauth
        tokens: {
          accessToken: string
          refreshToken: string
          expiresAt: string
          scopes?: string[] | undefined
          accountId?: string | undefined
        }
        authority?:
          | {
              url: string
              connectionId: string
              generation?: number | undefined
              refreshAfter?: string | undefined
              authorizationId?: string | undefined
              previousAuthorizationId?: string | undefined
            }
          | undefined
      }
    | { kind: EAuthKind.ApiKey; apiKey: string }
}

export type AccountLease = {
  accounts: StoredAccountDto[]
  active: { provider: string; accountId: string }[]
}
