import type { OauthCredential } from '@dltech/atlas-core'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type CodexCacheStore = {
  read: () => Promise<string | undefined> | string | undefined
  write: (text: string) => Promise<void> | void
}

export type CodexModelsPorts = {
  fetch: FetchLike
  cache: CodexCacheStore
  now: () => string
  identityOf: (credential: OauthCredential) => string | Promise<string>
}
