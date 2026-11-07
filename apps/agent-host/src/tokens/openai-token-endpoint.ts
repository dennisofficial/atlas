import type { TokenFetch } from './anthropic-token-endpoint'
import { ProviderRateLimitedError, ProviderRejectedError, type ProviderGrant } from './oauth-types'

const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REQUEST_TIMEOUT_MS = 10_000
const FALLBACK_LIFETIME_SECONDS = 3600
const REJECTING_STATUSES = [400, 401, 403]
const AUTH_CLAIM = 'https://api.openai.com/auth'

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const claimsOf = (jwt: string | undefined): Record<string, unknown> | undefined => {
  const payload = jwt?.split('.')[1]
  if (payload === undefined || payload.length === 0) return undefined
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof claims === 'object' && claims !== null
      ? (claims as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

const chatgptAccountIdOf = (idToken: string | undefined): string | undefined => {
  const auth = claimsOf(idToken)?.[AUTH_CLAIM]
  if (typeof auth !== 'object' || auth === null) return undefined
  return stringOr((auth as { chatgpt_account_id?: unknown }).chatgpt_account_id)
}

const expiryOf = (args: { accessToken: string; expiresIn: unknown; nowMs: number }): string => {
  if (typeof args.expiresIn === 'number' && Number.isFinite(args.expiresIn)) {
    return new Date(args.nowMs + args.expiresIn * 1000).toISOString()
  }
  const exp = claimsOf(args.accessToken)?.exp
  if (typeof exp === 'number' && Number.isFinite(exp)) return new Date(exp * 1000).toISOString()
  return new Date(args.nowMs + FALLBACK_LIFETIME_SECONDS * 1000).toISOString()
}

export const refreshOpenAiGrant = async (args: {
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
    throw new ProviderRejectedError('the openai token endpoint rejected the grant')
  }
  if (response.status === 429)
    throw new ProviderRateLimitedError('the token endpoint is rate limiting')
  if (!response.ok) throw new Error(`the token endpoint answered HTTP ${response.status}`)
  const body = (await response.json()) as Record<string, unknown> | null
  const accessToken = stringOr(body?.access_token)
  if (accessToken === undefined)
    throw new Error('the token endpoint answered with an unusable body')
  const accountId = chatgptAccountIdOf(stringOr(body?.id_token))
  return {
    accessToken,
    refreshToken: stringOr(body?.refresh_token) ?? args.refreshToken,
    expiresAt: expiryOf({ accessToken, expiresIn: body?.expires_in, nowMs: args.nowMs }),
    ...(accountId === undefined ? {} : { accountId }),
  }
}
