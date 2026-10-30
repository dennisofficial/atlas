import type { ClockPort, OauthTokens } from '@dltech/atlas-core'

import {
  DeviceCodeDisabledError,
  openaiExchangeCode,
  openaiPollDevice,
  openaiRefresh,
  openaiStartDevice,
  OauthResponseError,
  type OauthLogin,
  type ProviderFetch,
} from '../../provider-oauth'
import {
  authorizeBrowserUrl,
  browserPkce,
  type BrowserLoginClient,
  type BrowserLoginSession,
} from './browser-login'
import { CodexLoopbackServer, type CodexLoopback } from './codex-loopback'
import type { DeviceLogin, DevicePoll } from './device-login'

const TUI_DEVICE_DISABLED =
  'device-code login is not enabled for this ChatGPT account. Enable "Sign in with device code" in ChatGPT security settings and press n to try again.'

export class CodexOauthClient implements BrowserLoginClient {
  private readonly clock: ClockPort
  private readonly fetch: ProviderFetch
  private readonly loopback: () => CodexLoopback

  constructor(args: {
    clock: ClockPort
    fetch?: ProviderFetch
    loopback?: () => CodexLoopback
  }) {
    this.clock = args.clock
    this.fetch = args.fetch ?? globalThis.fetch
    this.loopback = args.loopback ?? (() => new CodexLoopbackServer())
  }

  async startBrowserLogin(): Promise<BrowserLoginSession> {
    const server = this.loopback()
    const { redirectUri } = await server.listen()
    const pkce = browserPkce()
    const url = authorizeBrowserUrl({
      redirectUri,
      challenge: pkce.challenge,
      state: pkce.state,
    })

    let cancelled = false
    const login = server
      .waitForCallback({ state: pkce.state })
      .then(async ({ code }) => {
        const exchanged = await openaiExchangeCode({
          fetch: this.fetch,
          authorizationCode: code,
          codeVerifier: pkce.verifier,
          redirectUri,
          nowMs: this.nowMs,
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

  async startDeviceLogin(): Promise<DeviceLogin> {
    try {
      return await openaiStartDevice({ fetch: this.fetch })
    } catch (error) {
      if (error instanceof DeviceCodeDisabledError)
        throw new OauthResponseError(TUI_DEVICE_DISABLED)
      throw error
    }
  }

  pollDeviceLogin(args: { deviceAuthId: string; userCode: string }): Promise<DevicePoll> {
    return openaiPollDevice({ ...args, fetch: this.fetch, nowMs: this.nowMs })
  }

  refresh(args: { refreshToken: string }): Promise<OauthTokens> {
    return openaiRefresh({ ...args, fetch: this.fetch, nowMs: this.nowMs })
  }

  private readonly nowMs = (): number => Date.parse(this.clock.now())
}

export type { OauthLogin }
