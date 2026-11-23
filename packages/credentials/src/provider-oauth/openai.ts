import type { OauthTokens } from '@dltech/atlas-core'

import { DeviceCodeDisabledError, OauthHttpError, OauthResponseError } from './errors'
import { decodeJwtClaims } from './jwt-claims'
import {
  FALLBACK_LIFETIME_SECONDS,
  postTo,
  stringOr,
  type OauthLogin,
  type ProviderFetch,
} from './login'

// ChatGPT subscription login via OpenAI's bespoke device-code flow — the one `codex login
// --device-auth` uses, NOT RFC 8628 (verified against openai/codex `codex-rs/login`):
//   1. POST /api/accounts/deviceauth/usercode {client_id} → {device_auth_id, user_code, interval}
//   2. poll POST /api/accounts/deviceauth/token {device_auth_id, user_code}: HTTP 403/404 = still
//      pending; HTTP 200 = {authorization_code, code_verifier} (server-generated PKCE)
//   3. exchange POST /oauth/token (form) grant_type=authorization_code → {id_token, access_token,
//      refresh_token}
// The verification URL and 15-minute expiry are client-constructed; the server returns neither.
// The client id is a public value carried by the codex binary.
export const OPENAI_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  usercodeUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
  deviceTokenUrl: 'https://auth.openai.com/api/accounts/deviceauth/token',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  deviceRedirectUri: 'https://auth.openai.com/deviceauth/callback',
  verificationUrl: 'https://auth.openai.com/codex/device',
  deviceExpiresInMs: 15 * 60 * 1000,
} as const

// Byte-identical to `codex login` (openai/codex codex-rs/login/src/server.rs, pinned
// 67727e7cf114cf3e1b71db368d74b24e32f6cb12); the code exchange is a bare form POST with no
// originator or User-Agent header.
const BROWSER_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
const ORIGINATOR = 'codex_cli_rs'

export type DeviceLogin = {
  deviceAuthId: string
  userCode: string
  verificationUrl: string
  intervalMs: number
  expiresInMs: number
}

export enum EDevicePoll {
  Pending = 'pending',
  Complete = 'complete',
}

export type DevicePoll =
  | { status: EDevicePoll.Pending }
  | { status: EDevicePoll.Complete; login: OauthLogin }

export const openaiBrowserAuthorizeUrl = (args: {
  redirectUri: string
  challenge: string
  state: string
}): string => {
  const url = new URL(OPENAI_OAUTH.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', OPENAI_OAUTH.clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('code_challenge', args.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', args.state)
  url.searchParams.set('scope', BROWSER_SCOPE)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', ORIGINATOR)

  return url.toString()
}

const accountIdFrom = (
  idToken: string | undefined,
): { accountId: string } | Record<string, never> => {
  if (idToken === undefined) return {}
  const accountId = stringOr(
    decodeJwtClaims(idToken)?.['https://api.openai.com/auth']?.chatgpt_account_id,
  )
  return accountId === undefined ? {} : { accountId }
}

/** The token endpoint omits expires_in on some responses; the access token's own exp is the fallback. */
const expiryOf = (args: { accessToken: string; expiresIn: unknown; nowMs: number }): string => {
  if (typeof args.expiresIn === 'number' && Number.isFinite(args.expiresIn))
    return new Date(args.nowMs + args.expiresIn * 1000).toISOString()

  const exp = decodeJwtClaims(args.accessToken)?.exp
  if (typeof exp === 'number' && Number.isFinite(exp)) return new Date(exp * 1000).toISOString()

  return new Date(args.nowMs + FALLBACK_LIFETIME_SECONDS * 1000).toISOString()
}

type TokenBody = {
  id_token?: unknown
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

export const openaiStartDevice = async (args: { fetch: ProviderFetch }): Promise<DeviceLogin> => {
  const response = await postTo({
    fetch: args.fetch,
    url: OPENAI_OAUTH.usercodeUrl,
    body: JSON.stringify({ client_id: OPENAI_OAUTH.clientId }),
    contentType: 'application/json',
  })

  if (response.status === 404) throw new DeviceCodeDisabledError()
  if (!response.ok) throw new OauthHttpError({ provider: 'OpenAI', status: response.status })

  const body = (await response.json()) as {
    device_auth_id?: unknown
    user_code?: unknown
    usercode?: unknown
    interval?: unknown
  }

  const deviceAuthId = stringOr(body.device_auth_id)
  const userCode = stringOr(body.user_code) ?? stringOr(body.usercode)
  if (deviceAuthId === undefined || userCode === undefined)
    throw new OauthResponseError('it carries no device_auth_id or no user_code')

  // The poll interval arrives as either a number or a string ("0"); zero means "as fast as you like".
  const intervalRaw = typeof body.interval === 'string' ? Number(body.interval) : body.interval
  const intervalSeconds =
    typeof intervalRaw === 'number' && Number.isFinite(intervalRaw) ? intervalRaw : 5

  return {
    deviceAuthId,
    userCode,
    verificationUrl: OPENAI_OAUTH.verificationUrl,
    intervalMs: Math.max(intervalSeconds, 1) * 1000,
    expiresInMs: OPENAI_OAUTH.deviceExpiresInMs,
  }
}

export const openaiExchangeCode = async (args: {
  fetch: ProviderFetch
  authorizationCode: string
  codeVerifier: string
  redirectUri?: string | undefined
  nowMs: () => number
}): Promise<OauthLogin> => {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.authorizationCode,
    redirect_uri: args.redirectUri ?? OPENAI_OAUTH.deviceRedirectUri,
    client_id: OPENAI_OAUTH.clientId,
    code_verifier: args.codeVerifier,
  })

  const response = await postTo({
    fetch: args.fetch,
    url: OPENAI_OAUTH.tokenUrl,
    body: form.toString(),
    contentType: 'application/x-www-form-urlencoded',
  })

  if (!response.ok) throw new OauthHttpError({ provider: 'OpenAI', status: response.status })

  const raw = (await response.json()) as TokenBody
  const idToken = stringOr(raw.id_token)
  const accessToken = stringOr(raw.access_token)
  const refreshToken = stringOr(raw.refresh_token)
  if (idToken === undefined || accessToken === undefined || refreshToken === undefined)
    throw new OauthResponseError('it carries no id_token, no access_token or no refresh_token')

  const claims = decodeJwtClaims(idToken)
  const email =
    stringOr(claims?.email) ?? stringOr(claims?.['https://api.openai.com/profile']?.email)
  const plan = stringOr(claims?.['https://api.openai.com/auth']?.chatgpt_plan_type)

  return {
    tokens: {
      accessToken,
      refreshToken,
      expiresAt: expiryOf({
        accessToken,
        expiresIn: raw.expires_in,
        nowMs: args.nowMs(),
      }),
      ...accountIdFrom(idToken),
    },
    ...(email === undefined ? {} : { email }),
    ...(plan === undefined ? {} : { subscription: plan }),
  }
}

export const openaiPollDevice = async (args: {
  fetch: ProviderFetch
  deviceAuthId: string
  userCode: string
  nowMs: () => number
}): Promise<DevicePoll> => {
  const response = await postTo({
    fetch: args.fetch,
    url: OPENAI_OAUTH.deviceTokenUrl,
    body: JSON.stringify({
      device_auth_id: args.deviceAuthId,
      user_code: args.userCode,
    }),
    contentType: 'application/json',
  })

  if (response.status === 403 || response.status === 404) return { status: EDevicePoll.Pending }
  if (!response.ok) throw new OauthHttpError({ provider: 'OpenAI', status: response.status })

  const body = (await response.json()) as {
    authorization_code?: unknown
    code_verifier?: unknown
  }
  const authorizationCode = stringOr(body.authorization_code)
  const codeVerifier = stringOr(body.code_verifier)
  if (authorizationCode === undefined || codeVerifier === undefined)
    throw new OauthResponseError('it carries no authorization_code or no code_verifier')

  return {
    status: EDevicePoll.Complete,
    login: await openaiExchangeCode({
      fetch: args.fetch,
      authorizationCode,
      codeVerifier,
      nowMs: args.nowMs,
    }),
  }
}

export const openaiRefresh = async (args: {
  fetch: ProviderFetch
  refreshToken: string
  nowMs: () => number
}): Promise<OauthTokens> => {
  const response = await postTo({
    fetch: args.fetch,
    url: OPENAI_OAUTH.tokenUrl,
    body: JSON.stringify({
      client_id: OPENAI_OAUTH.clientId,
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
    }),
    contentType: 'application/json',
  })

  if (!response.ok) throw new OauthHttpError({ provider: 'OpenAI', status: response.status })

  const body = (await response.json()) as TokenBody
  const accessToken = stringOr(body.access_token)
  if (accessToken === undefined) throw new OauthResponseError('it carries no access_token')

  return {
    accessToken,
    refreshToken: stringOr(body.refresh_token) ?? args.refreshToken,
    expiresAt: expiryOf({
      accessToken,
      expiresIn: body.expires_in,
      nowMs: args.nowMs(),
    }),
    ...accountIdFrom(stringOr(body.id_token)),
  }
}
