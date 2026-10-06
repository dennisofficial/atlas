import { Injectable } from '@nestjs/common'
import { EOauthProvider, OauthIssuer, OauthRateLimitedError, OauthRejectedError } from './oauth-connections.types'

const REQUEST_TIMEOUT_MS = 10_000
const FALLBACK_LIFETIME_SECONDS = 3600
const REJECTING_STATUSES = [400, 401, 403]

interface IssuerEndpoint {
  url: string
  clientId: string
}

const ENDPOINTS: Record<EOauthProvider, IssuerEndpoint> = {
  [EOauthProvider.Anthropic]: {
    url: 'https://platform.claude.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  },
  [EOauthProvider.OpenAI]: {
    url: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  },
}

type IssuerResult = Awaited<ReturnType<OauthIssuer['refresh']>>

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const claimsOf = (jwt: string | undefined): Record<string, unknown> | undefined => {
  const payload = jwt?.split('.')[1]
  if (payload === undefined || payload.length === 0) return undefined
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const expiryOf = (args: { accessToken: string; expiresIn: unknown; nowMs: number }): string => {
  if (typeof args.expiresIn === 'number' && Number.isFinite(args.expiresIn)) {
    return new Date(args.nowMs + args.expiresIn * 1000).toISOString()
  }
  const exp = claimsOf(args.accessToken)?.exp
  if (typeof exp === 'number' && Number.isFinite(exp)) return new Date(exp * 1000).toISOString()
  return new Date(args.nowMs + FALLBACK_LIFETIME_SECONDS * 1000).toISOString()
}

function chatgptAccountId(idToken: string | undefined): string | undefined {
  const auth = claimsOf(idToken)?.['https://api.openai.com/auth']
  if (typeof auth !== 'object' || auth === null) return undefined
  return stringOr((auth as { chatgpt_account_id?: unknown }).chatgpt_account_id)
}

function malformed(): Error {
  return new Error('the token endpoint answered with an unusable body')
}

function anthropicResult(body: Record<string, unknown>, nowMs: number): IssuerResult {
  const accessToken = stringOr(body.access_token)
  const refreshToken = stringOr(body.refresh_token)
  if (accessToken === undefined || refreshToken === undefined) throw malformed()
  const scope = stringOr(body.scope)
  return {
    accessToken,
    refreshToken,
    expiresAt: expiryOf({ accessToken: '', expiresIn: body.expires_in, nowMs }),
    ...(scope === undefined ? {} : { scopes: scope.split(/\s+/).filter(Boolean) }),
  }
}

function openaiResult(body: Record<string, unknown>, nowMs: number): IssuerResult {
  const accessToken = stringOr(body.access_token)
  if (accessToken === undefined) throw malformed()
  const refreshToken = stringOr(body.refresh_token)
  const accountId = chatgptAccountId(stringOr(body.id_token))
  return {
    accessToken,
    expiresAt: expiryOf({ accessToken, expiresIn: body.expires_in, nowMs }),
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(accountId === undefined ? {} : { accountId }),
  }
}

@Injectable()
export class HttpOauthIssuer implements OauthIssuer {
  async refresh(args: {
    provider: EOauthProvider
    refreshToken: string
    nowMs: number
  }): Promise<IssuerResult> {
    const endpoint = ENDPOINTS[args.provider]
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: endpoint.clientId,
        refresh_token: args.refreshToken,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (REJECTING_STATUSES.includes(response.status)) {
      throw new OauthRejectedError(`the ${args.provider} token endpoint rejected the grant`)
    }
    if (response.status === 429) throw new OauthRateLimitedError('the token endpoint is rate limiting')
    if (!response.ok) throw new Error(`the token endpoint answered HTTP ${response.status}`)

    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) throw malformed()
    const record = body as Record<string, unknown>
    return args.provider === EOauthProvider.Anthropic
      ? anthropicResult(record, args.nowMs)
      : openaiResult(record, args.nowMs)
  }
}
