import { createHash, randomBytes } from 'node:crypto'

import type { ClockPort, OauthTokens } from '@dltech/atlas-core'

import {
  anthropicExchangeCode,
  anthropicExchangePasted,
  anthropicLoopbackAuthorizeUrl,
  anthropicManualAuthorizeUrl,
  anthropicRefresh,
  type OauthLogin,
  type Pkce,
  type ProviderFetch,
} from '../../provider-oauth'
import { AnthropicLoopbackServer, type AnthropicLoopback } from './anthropic-loopback'
import type { BrowserLoginClient, BrowserLoginSession } from './browser-login'

export type { OauthLogin, Pkce } from '../../provider-oauth'

const base64url = (bytes: Buffer): string => bytes.toString('base64url')

export class AnthropicOauthClient implements BrowserLoginClient {
  private readonly clock: ClockPort
  private readonly fetch: ProviderFetch
  private readonly loopback: () => AnthropicLoopback

  constructor(args: {
    clock: ClockPort
    fetch?: ProviderFetch
    loopback?: () => AnthropicLoopback
  }) {
    this.clock = args.clock
    this.fetch = args.fetch ?? globalThis.fetch
    this.loopback = args.loopback ?? (() => new AnthropicLoopbackServer())
  }

  async startBrowserLogin(): Promise<BrowserLoginSession> {
    const server = this.loopback()
    const { redirectUri } = await server.listen()
    const pkce = this.generatePkce()
    const url = this.authorizeBrowserUrl({ pkce, redirectUri })

    let cancelled = false
    const login = server
      .waitForCallback({ state: pkce.state })
      .then(async ({ code }) => {
        const exchanged = await this.exchangeBrowserCode({
          code,
          pkce,
          redirectUri,
        })
        if (cancelled) throw new Error('sign-in cancelled')

        return exchanged
      })
      .catch((error: unknown) => {
        if (cancelled) throw new Error('sign-in cancelled')
        throw error
      })
      .finally(() => server.close())

    return {
      url,
      login,
      cancel: async () => {
        cancelled = true
        await server.close()
      },
    }
  }

  generatePkce(): Pkce {
    const verifier = base64url(randomBytes(32))

    return {
      verifier,
      challenge: base64url(createHash('sha256').update(verifier).digest()),
      state: base64url(randomBytes(32)),
    }
  }

  authorizeUrl(pkce: Pkce): string {
    return anthropicManualAuthorizeUrl(pkce)
  }

  authorizeBrowserUrl(args: { pkce: Pkce; redirectUri: string }): string {
    return anthropicLoopbackAuthorizeUrl(args)
  }

  exchangeBrowserCode(args: {
    code: string
    pkce: Pkce
    redirectUri: string
  }): Promise<OauthLogin> {
    return anthropicExchangeCode({
      ...args,
      fetch: this.fetch,
      nowMs: this.nowMs,
    })
  }

  /** The operator pastes `code#state`; the fragment is a tamper check, not part of the code. */
  exchange(args: { pasted: string; pkce: Pkce }): Promise<OauthLogin> {
    return anthropicExchangePasted({
      ...args,
      fetch: this.fetch,
      nowMs: this.nowMs,
    })
  }

  refresh(args: { refreshToken: string }): Promise<OauthTokens> {
    return anthropicRefresh({ ...args, fetch: this.fetch, nowMs: this.nowMs })
  }

  private readonly nowMs = (): number => Date.parse(this.clock.now())
}
