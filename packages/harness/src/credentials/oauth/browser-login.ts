import { createHash, randomBytes } from 'node:crypto'

import type { Account, EAuthProvider } from '@dltech/atlas-core'

import { openaiBrowserAuthorizeUrl, type OauthLogin } from '../../provider-oauth'

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
// base64url.
export const browserPkce = (): {
  verifier: string
  challenge: string
  state: string
} => {
  const verifier = randomBytes(64).toString('base64url')

  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url'),
  }
}

export const authorizeBrowserUrl = (args: {
  redirectUri: string
  challenge: string
  state: string
}): string => openaiBrowserAuthorizeUrl(args)
