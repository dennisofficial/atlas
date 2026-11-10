import { EOAuthFailure, OAuthError, parseOAuthErrorBody } from './errors'
import type { Pkce } from './pkce'
import type { ClientInformation, OAuthFetch, OAuthTokens } from './types'

export const buildAuthorizationUrl = (args: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  pkce: Pkce
  scope?: string | undefined
  resource?: string | undefined
}): string => {
  const url = new URL(args.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('code_challenge', args.pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('state', args.pkce.state)
  if (args.scope !== undefined) url.searchParams.set('scope', args.scope)
  if (args.resource !== undefined) url.searchParams.set('resource', args.resource)
  return url.toString()
}

const applyClientAuth = (args: {
  params: URLSearchParams
  client: { clientId: string; clientSecret?: string | undefined }
  supportedMethods?: string[] | undefined
}): string | undefined => {
  const supported = args.supportedMethods ?? ['client_secret_basic']
  const { client } = args
  if (client.clientSecret !== undefined && supported.includes('client_secret_basic')) {
    const credentials = Buffer.from(
      `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`,
    ).toString('base64')
    args.params.set('client_id', client.clientId)
    return `Basic ${credentials}`
  }
  if (client.clientSecret !== undefined && supported.includes('client_secret_post')) {
    args.params.set('client_id', client.clientId)
    args.params.set('client_secret', client.clientSecret)
    return undefined
  }
  args.params.set('client_id', client.clientId)
  return undefined
}

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const parseTokens = (args: {
  raw: unknown
  nowMs: number
  fallbackRefreshToken?: string | undefined
}): OAuthTokens => {
  if (typeof args.raw !== 'object' || args.raw === null) {
    throw new OAuthError({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: 'the token response is not an object',
    })
  }
  const body = args.raw as {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    scope?: unknown
  }
  const accessToken = stringOr(body.access_token)
  if (accessToken === undefined) {
    throw new OAuthError({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: 'the token response carries no access_token',
    })
  }
  const refreshToken = stringOr(body.refresh_token) ?? args.fallbackRefreshToken
  const scope = stringOr(body.scope)
  const expiresAt =
    typeof body.expires_in === 'number' && Number.isFinite(body.expires_in)
      ? new Date(args.nowMs + body.expires_in * 1000).toISOString()
      : undefined
  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(scope === undefined ? {} : { scope }),
  }
}

const normalizeErrorCode = (code: string): string =>
  ['invalid_refresh_token', 'expired_refresh_token', 'token_expired'].includes(code)
    ? 'invalid_grant'
    : code

const postTokenRequest = async (args: {
  tokenEndpoint: string
  params: URLSearchParams
  authorizationHeader?: string | undefined
  fetch: OAuthFetch
}): Promise<unknown> => {
  const response = await args.fetch(args.tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...(args.authorizationHeader === undefined
        ? {}
        : { authorization: args.authorizationHeader }),
    },
    body: args.params.toString(),
  })
  const raw: unknown = await response.json().catch(() => undefined)
  const errorBody = parseOAuthErrorBody(raw)
  if (errorBody !== undefined) {
    throw new OAuthError({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: errorBody.errorDescription ?? `the token endpoint answered ${errorBody.error}`,
      code: normalizeErrorCode(errorBody.error),
      status: response.status,
    })
  }
  if (!response.ok) {
    throw new OAuthError({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: `the token endpoint answered HTTP ${response.status}`,
      status: response.status,
    })
  }
  return raw
}

const clientAuthOf = (args: {
  params: URLSearchParams
  client: ClientInformation
  authMethods?: string[] | undefined
}): string | undefined =>
  applyClientAuth({
    params: args.params,
    client: {
      clientId: args.client.clientId,
      ...(args.client.clientSecret === undefined ? {} : { clientSecret: args.client.clientSecret }),
    },
    ...(args.authMethods === undefined ? {} : { supportedMethods: args.authMethods }),
  })

export const exchangeAuthorizationCode = async (args: {
  tokenEndpoint: string
  code: string
  codeVerifier: string
  redirectUri: string
  client: ClientInformation
  authMethods?: string[] | undefined
  resource?: string | undefined
  nowMs: number
  fetch: OAuthFetch
}): Promise<OAuthTokens> => {
  const params = new URLSearchParams()
  params.set('grant_type', 'authorization_code')
  if (args.resource !== undefined) params.set('resource', args.resource)
  params.set('code', args.code)
  params.set('redirect_uri', args.redirectUri)
  params.set('code_verifier', args.codeVerifier)
  const authorizationHeader = clientAuthOf({
    params,
    client: args.client,
    authMethods: args.authMethods,
  })
  const raw = await postTokenRequest({
    tokenEndpoint: args.tokenEndpoint,
    params,
    ...(authorizationHeader === undefined ? {} : { authorizationHeader }),
    fetch: args.fetch,
  })
  return parseTokens({ raw, nowMs: args.nowMs })
}

export const refreshAuthorization = async (args: {
  tokenEndpoint: string
  refreshToken: string
  client: ClientInformation
  authMethods?: string[] | undefined
  resource?: string | undefined
  nowMs: number
  fetch: OAuthFetch
}): Promise<OAuthTokens> => {
  const params = new URLSearchParams()
  params.set('grant_type', 'refresh_token')
  if (args.resource !== undefined) params.set('resource', args.resource)
  params.set('refresh_token', args.refreshToken)
  const authorizationHeader = clientAuthOf({
    params,
    client: args.client,
    authMethods: args.authMethods,
  })
  const raw = await postTokenRequest({
    tokenEndpoint: args.tokenEndpoint,
    params,
    ...(authorizationHeader === undefined ? {} : { authorizationHeader }),
    fetch: args.fetch,
  })
  return parseTokens({ raw, nowMs: args.nowMs, fallbackRefreshToken: args.refreshToken })
}
