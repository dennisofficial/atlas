const ANTHROPIC_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

const REQUEST_TIMEOUT_MS = 15_000
const FALLBACK_LIFETIME_SECONDS = 3600

export type RefreshedTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export class OAuthRefreshError extends Error {
  constructor(args: { provider: string; status: number; detail?: string }) {
    super(
      `the ${args.provider} token endpoint refused the refresh (${args.status})${
        args.detail === undefined ? '' : `: ${args.detail}`
      }`,
    )
    this.name = 'OAuthRefreshError'
  }
}

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const jwtExpiry = (token: string): number | undefined => {
  const segment = token.split('.')[1]
  if (segment === undefined) return undefined
  try {
    const claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as {
      exp?: unknown
    }
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp)
      ? claims.exp * 1000
      : undefined
  } catch {
    return undefined
  }
}

const expiryOf = (args: { accessToken: string; expiresIn: unknown }): string => {
  if (typeof args.expiresIn === 'number' && Number.isFinite(args.expiresIn))
    return new Date(Date.now() + args.expiresIn * 1000).toISOString()

  // OpenAI's token endpoint omits expires_in on some refresh responses; the access
  // token's own exp claim is the fallback there.
  const claimMs = jwtExpiry(args.accessToken)
  if (claimMs !== undefined) return new Date(claimMs).toISOString()

  return new Date(Date.now() + FALLBACK_LIFETIME_SECONDS * 1000).toISOString()
}

const post = async (args: {
  url: string
  provider: string
  body: Record<string, string>
  fetchFn: typeof fetch
}): Promise<Record<string, unknown>> => {
  const response = await args.fetchFn(args.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) throw new OAuthRefreshError({ provider: args.provider, status: response.status })

  const body: unknown = await response.json().catch(() => undefined)
  return (body ?? {}) as Record<string, unknown>
}

export async function refreshOauthTokens(args: {
  provider: string
  refreshToken: string
  fetchFn?: typeof fetch
}): Promise<RefreshedTokens> {
  const fetchFn = args.fetchFn ?? fetch

  if (args.provider === 'anthropic') {
    const body = await post({
      url: ANTHROPIC_TOKEN_URL,
      provider: 'Anthropic',
      fetchFn,
      body: {
        grant_type: 'refresh_token',
        refresh_token: args.refreshToken,
        client_id: ANTHROPIC_CLIENT_ID,
      },
    })

    const accessToken = stringOr(body.access_token)
    const refreshToken = stringOr(body.refresh_token)
    if (accessToken === undefined || refreshToken === undefined)
      throw new OAuthRefreshError({
        provider: 'Anthropic',
        status: 200,
        detail: 'the response carried no access_token or no refresh_token',
      })

    return {
      accessToken,
      refreshToken,
      expiresAt: expiryOf({ accessToken, expiresIn: body.expires_in }),
    }
  }

  if (args.provider === 'openai') {
    const body = await post({
      url: CODEX_TOKEN_URL,
      provider: 'OpenAI',
      fetchFn,
      body: {
        grant_type: 'refresh_token',
        refresh_token: args.refreshToken,
        client_id: CODEX_CLIENT_ID,
      },
    })

    const accessToken = stringOr(body.access_token)
    if (accessToken === undefined)
      throw new OAuthRefreshError({
        provider: 'OpenAI',
        status: 200,
        detail: 'the response carried no access_token',
      })

    return {
      accessToken,
      // OpenAI keeps the refresh token stable on some rotations; only a rotated one replaces it.
      refreshToken: stringOr(body.refresh_token) ?? args.refreshToken,
      expiresAt: expiryOf({ accessToken, expiresIn: body.expires_in }),
    }
  }

  throw new OAuthRefreshError({ provider: args.provider, status: 0, detail: 'no oauth refresh' })
}
