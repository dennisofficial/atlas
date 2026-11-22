import type { OauthTokens } from '@dltech/atlas-core'

import { OauthHttpError, OauthResponseError } from './errors'
import {
  FALLBACK_LIFETIME_SECONDS,
  postTo,
  stringOr,
  type OauthLogin,
  type ProviderFetch,
} from './login'
import { createPkce, type Pkce } from './pkce'

// Claude.ai subscription OAuth: authorization code + PKCE (S256). The client id and URLs are public
// values carried by the Claude Code binary (2.1.287); the loopback parameters were verified
// end-to-end against a real account in the 2026-10-02 spike. With `code=true` and the hosted
// redirect, Anthropic's callback page displays `code#state` for the user to paste back.
export const ANTHROPIC_OAUTH = {
  authorizeUrl: 'https://claude.com/cai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  manualRedirectUrl: 'https://platform.claude.com/oauth/code/callback',
  scopes: 'org:create_api_key user:profile user:inference',
} as const

export const anthropicPkce = (): Promise<Pkce> => createPkce({ verifierBytes: 32 })

const authorizeUrlWith = (args: {
  pkce: Pkce
  redirectUri: string
  manualCode: boolean
}): string => {
  const url = new URL(ANTHROPIC_OAUTH.authorizeUrl)
  url.searchParams.set('client_id', ANTHROPIC_OAUTH.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('scope', ANTHROPIC_OAUTH.scopes)
  url.searchParams.set('code_challenge', args.pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', args.pkce.state)
  if (args.manualCode) url.searchParams.set('code', 'true')

  return url.toString()
}

export const anthropicManualAuthorizeUrl = (pkce: Pkce): string =>
  authorizeUrlWith({
    pkce,
    redirectUri: ANTHROPIC_OAUTH.manualRedirectUrl,
    manualCode: true,
  })

// The loopback authorize request omits the `code=true` the paste-back flow sends — that param is
// what asks Anthropic for the manual code page (Claude Code 2.1.287; spike, 2026-10-02).
export const anthropicLoopbackAuthorizeUrl = (args: { pkce: Pkce; redirectUri: string }): string =>
  authorizeUrlWith({
    pkce: args.pkce,
    redirectUri: args.redirectUri,
    manualCode: false,
  })

export const anthropicLoginFrom = (args: { raw: unknown; nowMs: number }): OauthLogin => {
  const body = (args.raw ?? {}) as {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    scope?: unknown
    subscription_type?: unknown
    account?: { subscription_type?: unknown; email_address?: unknown }
  }

  const accessToken = stringOr(body.access_token)
  const refreshToken = stringOr(body.refresh_token)
  if (accessToken === undefined || refreshToken === undefined)
    throw new OauthResponseError('it carries no access_token or no refresh_token')

  const lifetimeSeconds =
    typeof body.expires_in === 'number' ? body.expires_in : FALLBACK_LIFETIME_SECONDS
  const scope = stringOr(body.scope)
  const email = stringOr(body.account?.email_address)
  const subscription = stringOr(body.subscription_type) ?? stringOr(body.account?.subscription_type)

  return {
    tokens: {
      accessToken,
      refreshToken,
      expiresAt: new Date(args.nowMs + lifetimeSeconds * 1000).toISOString(),
      ...(scope === undefined ? {} : { scopes: scope.split(/\s+/).filter(Boolean) }),
    },
    ...(email === undefined ? {} : { email }),
    ...(subscription === undefined ? {} : { subscription }),
  }
}

const postToken = async (args: {
  fetch: ProviderFetch
  body: Record<string, string>
  nowMs: () => number
}): Promise<OauthLogin> => {
  const response = await postTo({
    fetch: args.fetch,
    url: ANTHROPIC_OAUTH.tokenUrl,
    body: JSON.stringify(args.body),
    contentType: 'application/json',
  })

  if (!response.ok)
    throw new OauthHttpError({
      provider: 'Anthropic',
      status: response.status,
    })

  return anthropicLoginFrom({
    raw: await response.json(),
    nowMs: args.nowMs(),
  })
}

export const anthropicExchangeCode = (args: {
  fetch: ProviderFetch
  code: string
  pkce: Pkce
  redirectUri: string
  nowMs: () => number
}): Promise<OauthLogin> =>
  postToken({
    fetch: args.fetch,
    nowMs: args.nowMs,
    body: {
      grant_type: 'authorization_code',
      code: args.code,
      state: args.pkce.state,
      redirect_uri: args.redirectUri,
      client_id: ANTHROPIC_OAUTH.clientId,
      code_verifier: args.pkce.verifier,
    },
  })

/** The user pastes `code#state`; the fragment is a tamper check, not part of the code. */
export const anthropicExchangePasted = (args: {
  fetch: ProviderFetch
  pasted: string
  pkce: Pkce
  nowMs: () => number
}): Promise<OauthLogin> => {
  const [code, pastedState] = args.pasted.trim().split('#')

  if (pastedState !== undefined && pastedState !== args.pkce.state)
    return Promise.reject(
      new OauthResponseError('the pasted code carries a different state than the login began with'),
    )
  if (code === undefined || code.length === 0)
    return Promise.reject(new OauthResponseError('the pasted value holds no code'))

  return anthropicExchangeCode({
    fetch: args.fetch,
    code,
    pkce: args.pkce,
    redirectUri: ANTHROPIC_OAUTH.manualRedirectUrl,
    nowMs: args.nowMs,
  })
}

export const anthropicRefresh = async (args: {
  fetch: ProviderFetch
  refreshToken: string
  nowMs: () => number
}): Promise<OauthTokens> => {
  const login = await postToken({
    fetch: args.fetch,
    nowMs: args.nowMs,
    body: {
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: ANTHROPIC_OAUTH.clientId,
    },
  })
  return login.tokens
}
