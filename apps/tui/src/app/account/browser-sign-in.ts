import type { EAuthProvider } from '@dltech/atlas-core'

import { askForBrowser, type AccountsState } from '../../ui/accounts-model'
import { signInProvider } from '../accounts-api'
import type { ProviderSignInBeginInput, SessionApi } from '../session-api'
import {
  startProviderLoopback,
  type ProviderLoopback,
  type ProviderSignInLoopbackBegin,
} from '@dltech/atlas-client/loopback'

export type BrowserSignIn = {
  api: SessionApi
  provider: EAuthProvider
  open: (url: string) => unknown
  onStateUpdate: (change: (state: AccountsState) => AccountsState) => void
  onSignedIn: () => void
  onFallback: () => void
  onFailed: (reason: string) => void
}

export type BrowserSignInJob = { stop: () => void }

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

const askForBrowserAt = (args: {
  provider: EAuthProvider
  url: string
  onStateUpdate: (change: (state: AccountsState) => AccountsState) => void
}): void =>
  args.onStateUpdate((state) =>
    askForBrowser({ state, prompt: { provider: args.provider, url: args.url } }),
  )

const beginOf =
  (args: { api: SessionApi; provider: EAuthProvider }) =>
  async (asked: { redirectUri: string }): Promise<ProviderSignInLoopbackBegin> => {
    const begun = await args.api.beginProviderSignIn({
      provider: signInProvider(args.provider),
      flow: 'loopback' as ProviderSignInBeginInput['flow'],
      redirectUri: asked.redirectUri,
    })
    if (begun.flow !== 'loopback') throw new Error('the api did not begin a browser sign-in')

    return {
      attemptId: begun.attemptId,
      authorizeUrl: begun.authorizeUrl,
      state: begun.state,
    }
  }

export const startBrowserSignIn = (args: BrowserSignIn): BrowserSignInJob => {
  const held: { cancelled: boolean; loopback: ProviderLoopback | null } = {
    cancelled: false,
    loopback: null,
  }
  const cancel = new AbortController()

  const settleInBrowser = async (): Promise<void> => {
    askForBrowserAt({ provider: args.provider, url: '', onStateUpdate: args.onStateUpdate })

    let loopback: ProviderLoopback
    try {
      loopback = await startProviderLoopback({
        provider: args.provider,
        begin: beginOf({ api: args.api, provider: args.provider }),
        open: args.open,
        signal: cancel.signal,
      })
    } catch {
      if (!held.cancelled) args.onFallback()
      return
    }

    if (held.cancelled) {
      loopback.stop()
      return
    }

    held.loopback = loopback
    askForBrowserAt({
      provider: args.provider,
      url: loopback.authorizeUrl,
      onStateUpdate: args.onStateUpdate,
    })

    const done = await loopback.done
    held.loopback = null
    if (held.cancelled) return
    if (done === undefined) {
      args.onFallback()
      return
    }

    try {
      await args.api.completeProviderSignIn(done)
    } catch (failure) {
      if (!held.cancelled) args.onFailed(reasonOf(failure))
      return
    }
    if (held.cancelled) return

    args.onSignedIn()
  }

  void settleInBrowser()

  return {
    stop: () => {
      held.cancelled = true
      cancel.abort()
      held.loopback?.stop()
      held.loopback = null
    },
  }
}
