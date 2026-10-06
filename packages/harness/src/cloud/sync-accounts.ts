import {
  EAuthKind,
  type AccountDraft,
  type AccountSecret,
  type AccountStorePort,
  type SettingsStorePort,
  type StoredAccount,
} from '@dltech/atlas-core'

import type { FileSecretsStore } from '../secrets/file-secrets-store'

export type CloudSyncStores = {
  accounts: AccountStorePort
  secrets: FileSecretsStore | undefined
  settings: SettingsStorePort | undefined
}

export type CloudSyncCounts = {
  accounts: number
  secrets: number
  mcpServers: number
  settings: number
}

export const sameAccountSecret = (a: AccountSecret, b: AccountSecret): boolean => {
  if (a.kind !== b.kind) return false
  if (a.kind === EAuthKind.ApiKey && b.kind === EAuthKind.ApiKey) return a.apiKey === b.apiKey
  if (a.kind === EAuthKind.Oauth && b.kind === EAuthKind.Oauth) {
    return (
      a.tokens.accessToken === b.tokens.accessToken &&
      a.tokens.refreshToken === b.tokens.refreshToken &&
      a.authority?.url === b.authority?.url &&
      a.authority?.connectionId === b.authority?.connectionId
    )
  }
  return false
}

export const accountDraftOf = (stored: StoredAccount): AccountDraft => ({
  provider: stored.provider,
  label: stored.label,
  secret: stored.secret,
  origin: stored.origin,
  ...(stored.email === undefined ? {} : { email: stored.email }),
  ...(stored.subscription === undefined ? {} : { subscription: stored.subscription }),
  ...(stored.importedFrom === undefined ? {} : { importedFrom: stored.importedFrom }),
})
