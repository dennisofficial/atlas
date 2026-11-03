// https://vercel.com/docs/sign-in-with-vercel/authorization-server-api
import { createHash, randomBytes } from 'node:crypto'
import type { VercelFetch } from './vercel-oauth.types'

export const VERCEL_AUTHORIZE_URL = 'https://vercel.com/oauth/authorize'
export const VERCEL_TOKEN_URL = 'https://api.vercel.com/login/oauth/token'
export const VERCEL_REVOKE_URL = 'https://api.vercel.com/login/oauth/token/revoke'
export const VERCEL_USERINFO_URL = 'https://api.vercel.com/login/oauth/userinfo'
export const VERCEL_OAUTH_SCOPE = 'openid offline_access'

export type VercelTokenGrant = {
  accessToken: string
  refreshToken: string | null
  expiresIn: number
  idToken: string | null
}

export class VercelOauthRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'VercelOauthRequestError'
  }
}

export function vercelPkce(): {
  state: string
  nonce: string
  verifier: string
  challenge: string
} {
  const state = randomBytes(24).toString('base64url')
  const nonce = randomBytes(24).toString('base64url')
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { state, nonce, verifier, challenge }
}

export function vercelAuthorizeUrl(args: {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  challenge: string
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    nonce: args.nonce,
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
    response_type: 'code',
    scope: VERCEL_OAUTH_SCOPE,
  })
  return `${VERCEL_AUTHORIZE_URL}?${params.toString()}`
}

async function postTokenRequest(args: {
  fetch: VercelFetch
  body: Record<string, string>
}): Promise<VercelTokenGrant> {
  const response = await args.fetch(VERCEL_TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams(args.body),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = payload as { error?: unknown; error_description?: unknown } | null
    const code = typeof parsed?.error === 'string' ? parsed.error : null
    const description =
      typeof parsed?.error_description === 'string' ? parsed.error_description : response.statusText
    throw new VercelOauthRequestError(response.status, code, description.slice(0, 300))
  }
  const parsed = payload as {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    id_token?: unknown
  } | null
  if (typeof parsed?.access_token !== 'string') {
    throw new VercelOauthRequestError(response.status, null, 'token response held no access token')
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : null,
    expiresIn: typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600,
    idToken: typeof parsed.id_token === 'string' ? parsed.id_token : null,
  }
}

// https://vercel.com/docs/sign-in-with-vercel/authorization-server-api — the id_token nonce
// is the replay guard on the exchange; the token itself just arrived from Vercel over TLS
export function idTokenNonceOf(idToken: string): string | null {
  const payload = idToken.split('.')[1]
  if (payload === undefined) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      nonce?: unknown
    }
    return typeof claims.nonce === 'string' ? claims.nonce : null
  } catch {
    return null
  }
}

export function exchangeVercelAuthorizationCode(args: {
  fetch: VercelFetch
  clientId: string
  clientSecret: string
  code: string
  verifier: string
  redirectUri: string
}): Promise<VercelTokenGrant> {
  return postTokenRequest({
    fetch: args.fetch,
    body: {
      grant_type: 'authorization_code',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      code_verifier: args.verifier,
      redirect_uri: args.redirectUri,
    },
  })
}

export function refreshVercelToken(args: {
  fetch: VercelFetch
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<VercelTokenGrant> {
  return postTokenRequest({
    fetch: args.fetch,
    body: {
      grant_type: 'refresh_token',
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
    },
  })
}

export async function revokeVercelToken(args: {
  fetch: VercelFetch
  clientId: string
  clientSecret: string
  token: string
}): Promise<void> {
  const credentials = Buffer.from(`${args.clientId}:${args.clientSecret}`).toString('base64')
  await args
    .fetch(VERCEL_REVOKE_URL, {
      method: 'POST',
      headers: { authorization: `Basic ${credentials}` },
      body: new URLSearchParams({ token: args.token }),
    })
    .catch(() => undefined)
}

export async function vercelUserIdOf(args: {
  fetch: VercelFetch
  accessToken: string
}): Promise<string | null> {
  const response = await args.fetch(VERCEL_USERINFO_URL, {
    headers: { authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) return null
  const payload = (await response.json().catch(() => null)) as { sub?: unknown } | null
  return typeof payload?.sub === 'string' ? payload.sub : null
}
