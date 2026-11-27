import { describe, expect, it } from 'bun:test'

import { anthropicLoopbackAuthorizeUrl, anthropicManualAuthorizeUrl } from '../anthropic'
import { openaiBrowserAuthorizeUrl } from '../openai'
import type { Pkce } from '../pkce'

const PKCE: Pkce = { verifier: 'verifier-1', challenge: 'challenge-1', state: 'state-1' }

const REDIRECT = 'http://localhost:53682/callback'

describe('a provider authorize URL', () => {
  it('asks Claude for the manual code page on the hosted redirect', () => {
    const url = new URL(anthropicManualAuthorizeUrl(PKCE))

    expect(url.searchParams.get('code')).toBe('true')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://platform.claude.com/oauth/code/callback',
    )
  })

  it('sends code=true on the loopback redirect too, as Claude Code does', () => {
    const url = new URL(anthropicLoopbackAuthorizeUrl({ pkce: PKCE, redirectUri: REDIRECT }))

    expect(url.searchParams.get('code')).toBe('true')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('asks Codex for its own scopes, originator and loopback redirect', () => {
    const url = new URL(
      openaiBrowserAuthorizeUrl({
        redirectUri: 'http://127.0.0.1:1455/auth/callback',
        challenge: 'challenge-1',
        state: 'state-1',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback')
    expect(url.searchParams.get('scope')).toBe(
      'openid profile email offline_access api.connectors.read api.connectors.invoke',
    )
    expect(url.searchParams.get('originator')).toBe('codex_cli_rs')
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(url.searchParams.get('id_token_add_organizations')).toBe('true')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})
