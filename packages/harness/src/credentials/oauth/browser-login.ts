import { createHash, randomBytes } from 'node:crypto'

import type { Account, EAuthProvider } from '@dltech/atlas-core'

import type { OauthLogin } from './anthropic-oauth-client'

export type BrowserLoginSession = {
  url: string
  login: Promise<OauthLogin>
  cancel(): Promise<void>
}

export type BrowserTicket = {
  provider: EAuthProvider
  url: string
  login: Promise<Account>
  cancel(): Promise<void>
}

export interface BrowserLoginClient {
  startBrowserLogin(): Promise<BrowserLoginSession>
}

// Byte-identical to `codex login` (openai/codex codex-rs/login/src/server.rs, pinned
// 67727e7cf114cf3e1b71db368d74b24e32f6cb12): verifier = 64 random bytes and state = 32, both
// base64url; the code exchange is a bare form POST with no originator or User-Agent header.
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const BROWSER_SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
const ORIGINATOR = 'codex_cli_rs'

export const browserPkce = (): { verifier: string; challenge: string; state: string } => {
  const verifier = randomBytes(64).toString('base64url')

  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url'),
  }
}

export const authorizeBrowserUrl = (args: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
}): string => {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.clientId)
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
