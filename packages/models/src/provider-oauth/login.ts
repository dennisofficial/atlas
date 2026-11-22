import type { OauthTokens } from '@dltech/atlas-core'

export type OauthLogin = {
  tokens: OauthTokens
  email?: string
  subscription?: string
}

export type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>

export const REQUEST_TIMEOUT_MS = 10_000
export const FALLBACK_LIFETIME_SECONDS = 3600

export const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

export const postTo = (args: {
  fetch: ProviderFetch
  url: string
  body: string
  contentType: string
}): Promise<Response> =>
  args.fetch(args.url, {
    method: 'POST',
    headers: { 'content-type': args.contentType },
    body: args.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
