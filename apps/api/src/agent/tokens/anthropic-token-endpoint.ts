import { ProviderRateLimitedError, ProviderRejectedError, type ProviderGrant } from './oauth-types'

const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REQUEST_TIMEOUT_MS = 10_000
const FALLBACK_LIFETIME_SECONDS = 3600
const REJECTING_STATUSES = [400, 401, 403]

export type TokenFetch = (input: string, init?: RequestInit) => Promise<Response>

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

export const refreshAnthropicGrant = async (args: {
  refreshToken: string
  nowMs: number
  fetchFn?: TokenFetch | undefined
}): Promise<ProviderGrant> => {
  const send = args.fetchFn ?? fetch
  const response = await send(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: args.refreshToken,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (REJECTING_STATUSES.includes(response.status)) {
    throw new ProviderRejectedError('the anthropic token endpoint rejected the grant')
  }
  if (response.status === 429)
    throw new ProviderRateLimitedError('the token endpoint is rate limiting')
  if (!response.ok) throw new Error(`the token endpoint answered HTTP ${response.status}`)
  const body = (await response.json()) as Record<string, unknown> | null
  const accessToken = stringOr(body?.access_token)
  const refreshToken = stringOr(body?.refresh_token)
  if (accessToken === undefined || refreshToken === undefined) {
    throw new Error('the token endpoint answered with an unusable body')
  }
  const lifetime =
    typeof body?.expires_in === 'number' && Number.isFinite(body.expires_in)
      ? body.expires_in
      : FALLBACK_LIFETIME_SECONDS
  const scope = stringOr(body?.scope)
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(args.nowMs + lifetime * 1000).toISOString(),
    ...(scope === undefined ? {} : { scopes: scope.split(/\s+/).filter(Boolean) }),
  }
}
