import type { ClockPort } from '@dltech/atlas-core'

import type { OAuthFetch } from './discovery'
import { EOAuthFailure, OAuthError, parseOAuthErrorBody } from './oauth-error'
import type { Pkce } from './pkce'

export type OAuthTokens = {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  scope?: string
}

export const buildAuthorizationUrl = (args: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  pkce: Pkce
  scope?: string
  resource?: string
}): string => {
  const url = new URL(args.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('code_challenge', args.pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('state', args.pkce.state)
  if (args.scope !== undefined) url.searchParams.set('scope', args.scope)
  // RFC 8707: resource pins the audience to the MCP server; only sent when PRM metadata exists.
  if (args.resource !== undefined) url.searchParams.set('resource', args.resource)
  return url.toString()
}

type ClientAuth = { clientId: string; clientSecret?: string }

// RFC 6749 §2.3.1: prefer client_secret_basic, fall back to client_secret_post, else public
// client with client_id in the body.
const applyClientAuth = (args: {
  params: URLSearchParams
  auth: ClientAuth
  supportedMethods?: string[]
}): string | undefined => {
  const supported = args.supportedMethods ?? ['client_secret_basic']
  const { auth } = args

  if (auth.clientSecret !== undefined && supported.includes('client_secret_basic')) {
    const credentials = Buffer.from(
      `${encodeURIComponent(auth.clientId)}:${encodeURIComponent(auth.clientSecret)}`,
    ).toString('base64')
    args.params.set('client_id', auth.clientId)
    return `Basic ${credentials}`
  }
  if (auth.clientSecret !== undefined && supported.includes('client_secret_post')) {
    args.params.set('client_id', auth.clientId)
    args.params.set('client_secret', auth.clientSecret)
    return undefined
  }
  args.params.set('client_id', auth.clientId)
  return undefined
}

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const parseTokens = (args: {
  raw: unknown
  clock: ClockPort
  fallbackRefreshToken?: string
}): OAuthTokens => {
  if (typeof args.raw !== 'object' || args.raw === null)
    throw new OAuthError({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: 'the token response is not an object',
    })
  const body = args.raw as {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    scope?: unknown
  }
  const accessToken = stringOr(body.access_token)
  if (accessToken === undefined)
    throw new OAuthError({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: 'the token response carries no access_token',
    })

  const refreshToken = stringOr(body.refresh_token) ?? args.fallbackRefreshToken
  const scope = stringOr(body.scope)
  const expiresAt =
    typeof body.expires_in === 'number' && Number.isFinite(body.expires_in)
      ? new Date(Date.parse(args.clock.now()) + body.expires_in * 1000).toISOString()
      : undefined

  return {
    accessToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(scope === undefined ? {} : { scope }),
  }
}

// Some servers answer refresh failures with non-standard codes; RFC 6749 §5.2 defines only
// invalid_grant for an unusable grant, so the rest collapse onto it.
const normalizeErrorCode = (code: string): string => {
  if (['invalid_refresh_token', 'expired_refresh_token', 'token_expired'].includes(code))
    return 'invalid_grant'
  return code
}

const postTokenRequest = async (args: {
  tokenEndpoint: string
  params: URLSearchParams
  authorizationHeader?: string
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
  if (errorBody !== undefined)
    throw new OAuthError({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: errorBody.errorDescription ?? `the token endpoint answered ${errorBody.error}`,
      code: normalizeErrorCode(errorBody.error),
      status: response.status,
    })
  if (!response.ok)
    throw new OAuthError({
      failure: EOAuthFailure.TokenExchangeFailed,
      message: `the token endpoint answered HTTP ${response.status}`,
      status: response.status,
    })
  return raw
}

export const exchangeAuthorizationCode = async (args: {
  tokenEndpoint: string
  code: string
  pkce: Pkce
  redirectUri: string
  clientId: string
  clientSecret?: string
  tokenEndpointAuthMethodsSupported?: string[]
  clock: ClockPort
  fetch: OAuthFetch
}): Promise<OAuthTokens> => {
  const params = new URLSearchParams()
  params.set('grant_type', 'authorization_code')
  params.set('code', args.code)
  params.set('redirect_uri', args.redirectUri)
  params.set('code_verifier', args.pkce.verifier)
  const authorizationHeader = applyClientAuth({
    params,
    auth: {
      clientId: args.clientId,
      ...(args.clientSecret === undefined ? {} : { clientSecret: args.clientSecret }),
    },
    ...(args.tokenEndpointAuthMethodsSupported === undefined
      ? {}
      : { supportedMethods: args.tokenEndpointAuthMethodsSupported }),
  })

  const raw = await postTokenRequest({
    tokenEndpoint: args.tokenEndpoint,
    params,
    ...(authorizationHeader === undefined ? {} : { authorizationHeader }),
    fetch: args.fetch,
  })
  return parseTokens({ raw, clock: args.clock })
}

export const refreshAuthorization = async (args: {
  tokenEndpoint: string
  refreshToken: string
  clientId: string
  clientSecret?: string
  tokenEndpointAuthMethodsSupported?: string[]
  clock: ClockPort
  fetch: OAuthFetch
}): Promise<OAuthTokens> => {
  const params = new URLSearchParams()
  params.set('grant_type', 'refresh_token')
  params.set('refresh_token', args.refreshToken)
  const authorizationHeader = applyClientAuth({
    params,
    auth: {
      clientId: args.clientId,
      ...(args.clientSecret === undefined ? {} : { clientSecret: args.clientSecret }),
    },
    ...(args.tokenEndpointAuthMethodsSupported === undefined
      ? {}
      : { supportedMethods: args.tokenEndpointAuthMethodsSupported }),
  })

  const raw = await postTokenRequest({
    tokenEndpoint: args.tokenEndpoint,
    params,
    ...(authorizationHeader === undefined ? {} : { authorizationHeader }),
    fetch: args.fetch,
  })
  return parseTokens({ raw, clock: args.clock, fallbackRefreshToken: args.refreshToken })
}
