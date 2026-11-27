import { useCallback, useRef, type MutableRefObject } from 'react'

import { EAuthProvider, providerSpec } from '@dltech/atlas-core'

import {
  acceptsApiKey,
  acceptsDeviceCode,
  acceptsPastedCode,
  askForApiKey,
  askForCode,
  askForDeviceCode,
  backToList,
  EAccountsView,
  EPickIntent,
  EProviderAction,
  failed,
  openLoginPicker,
  pickedAccount,
  working,
  type AccountsState,
} from '../ui/accounts-model'
import {
  activeProvider,
  apiKeyBody,
  EXPIRED,
  MIN_POLL_MS,
  reasonOf,
  signInElsewhere,
  signInProvider,
} from './accounts-api'
import { ELoginFlow } from './account/login-flow'
import { startBrowserSignIn, type BrowserSignInJob } from './account/browser-sign-in'
import { providerLoopbackOf } from './account/provider-loopback'
import type { ProviderSignInBegin, SessionApi } from './session-api'
import { pollSignInUntilSettled } from './sign-in-poll'

export type AccountFlows = {
  beginLogin: (current: AccountsState) => void
  askForKey: (current: AccountsState) => void
  runAction: (current: AccountsState, action: EProviderAction | undefined) => void
  confirmPick: (current: AccountsState) => void
  submit: (current: AccountsState) => void
  handleOpenUrl: () => void
  clearTicket: () => void
  stopPoll: () => void
  stopBrowser: () => void
}

export function useAccountFlows(args: {
  api: SessionApi | null
  held: MutableRefObject<AccountsState | null>
  put: (next: AccountsState | null) => void
  refresh: (change?: (state: AccountsState) => AccountsState) => void
  openUrl: (url: string) => unknown
  onChanged: () => void
  flow: ELoginFlow
  minPollIntervalMs?: number | undefined
}): AccountFlows {
  const { api, held, put, refresh, openUrl, onChanged } = args
  const ticket = useRef<{ attemptId: string } | null>(null)
  const polling = useRef<{ cancelled: boolean } | null>(null)
  const browser = useRef<BrowserSignInJob | null>(null)

  const stopPoll = useCallback(() => {
    if (polling.current !== null) polling.current.cancelled = true
    polling.current = null
  }, [])

  const stopBrowser = useCallback(() => {
    browser.current?.stop()
    browser.current = null
  }, [])

  const clearTicket = useCallback(() => {
    ticket.current = null
  }, [])

  const failWith = useCallback(
    (reason: string) => {
      const now = held.current
      if (now !== null) put(failed({ state: now, reason }))
    },
    [held, put],
  )

  const beginDevice = useCallback(
    (current: AccountsState, begun: Extract<ProviderSignInBegin, { flow: 'device-code' }>) => {
      if (api === null) return

      put(
        askForDeviceCode({
          state: current,
          prompt: {
            provider: current.rows[current.index]?.provider ?? EAuthProvider.Anthropic,
            url: begun.verificationUrl,
            userCode: begun.userCode,
          },
        }),
      )
      openUrl(begun.verificationUrl)

      const token = { cancelled: false }
      polling.current = token
      void pollSignInUntilSettled({
        intervalMs: Math.max(begun.intervalMs, args.minPollIntervalMs ?? MIN_POLL_MS),
        expiresInMs: begun.expiresInMs,
        poll: () => api.pollProviderSignIn({ attemptId: begun.attemptId }),
        wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        isCancelled: () => token.cancelled,
      })
        .then((answer) => {
          if (answer === null) return
          if (answer.status !== 'complete') {
            failWith(EXPIRED)
            return
          }
          onChanged()
          refresh((next) => ({ ...backToList(next), notice: 'Signed in.' }))
        })
        .catch((failure: unknown) => failWith(reasonOf(failure)))
    },
    [api, args.minPollIntervalMs, failWith, onChanged, openUrl, put, refresh],
  )

  const beginRemote = useCallback(
    (current: AccountsState, provider: EAuthProvider) => {
      if (api === null) return

      void api
        .beginProviderSignIn({ provider: signInProvider(provider) })
        .then((begun) => {
          const now = held.current
          if (now === null) return

          if (begun.flow === 'device-code') {
            beginDevice(now, begun)
            return
          }

          ticket.current = { attemptId: begun.attemptId }
          put(askForCode({ state: now, prompt: { provider, url: begun.authorizeUrl } }))
          openUrl(begun.authorizeUrl)
        })
        .catch((failure: unknown) => failWith(reasonOf(failure)))
    },
    [api, beginDevice, failWith, held, openUrl, put],
  )

  const beginBrowser = useCallback(
    (provider: EAuthProvider) => {
      if (api === null) return
      stopBrowser()
      browser.current = startBrowserSignIn({
        api,
        provider,
        open: openUrl,
        onStateUpdate: (change) => {
          const now = held.current
          if (now !== null) put(change(now))
        },
        onSignedIn: () => {
          onChanged()
          refresh((next) => ({ ...backToList(next), notice: 'Signed in.' }))
        },
        onFallback: () => {
          const now = held.current
          if (now !== null) beginRemote(now, provider)
        },
        onFailed: failWith,
      })
    },
    [api, beginRemote, failWith, held, onChanged, openUrl, put, refresh, stopBrowser],
  )

  const beginLogin = useCallback(
    (current: AccountsState) => {
      const provider = current.rows[current.index]?.provider
      if (provider === undefined || api === null) return

      if (!acceptsPastedCode(provider) && !acceptsDeviceCode(provider)) {
        put(failed({ state: current, reason: signInElsewhere(provider) }))
        return
      }

      const browserShape = providerLoopbackOf(provider)
      if (args.flow === ELoginFlow.Loopback && browserShape !== undefined) {
        beginBrowser(provider)
        return
      }

      beginRemote(current, provider)
    },
    [api, args.flow, beginBrowser, beginRemote, put],
  )

  const askForKey = useCallback(
    (current: AccountsState) => {
      const provider = current.rows[current.index]?.provider
      if (provider === undefined || !acceptsApiKey(provider)) return
      put(askForApiKey({ state: current, provider }))
    },
    [put],
  )

  const confirmPick = useCallback(
    (current: AccountsState) => {
      const account = pickedAccount(current)
      if (account === undefined || api === null) return

      const used = current.pickIntent === EPickIntent.Use
      const work = used
        ? api
            .setActiveAccount({ provider: activeProvider(account.provider), accountId: account.id })
            .then(() => onChanged())
        : api.removeAccount({ accountId: account.id })

      void work
        .then(() =>
          refresh((next) => ({
            ...backToList(next),
            notice: used
              ? `Active ${providerSpec(account.provider).label} login: ${account.label}.`
              : `Removed ${account.label}.`,
          })),
        )
        .catch((failure: unknown) => failWith(reasonOf(failure)))
    },
    [api, failWith, onChanged, refresh],
  )

  const runAction = useCallback(
    (current: AccountsState, action: EProviderAction | undefined) => {
      if (action === EProviderAction.SignIn) {
        beginLogin(current)
        return
      }
      if (action === EProviderAction.AddApiKey) {
        askForKey(current)
        return
      }
      if (action === EProviderAction.SwitchActive) {
        put(openLoginPicker({ state: current, intent: EPickIntent.Use }))
        return
      }
      if (action === EProviderAction.RemoveLogin) {
        put(openLoginPicker({ state: current, intent: EPickIntent.Remove }))
      }
    },
    [askForKey, beginLogin, put],
  )

  const submit = useCallback(
    (current: AccountsState) => {
      const pasted = current.typed.trim()
      if (pasted.length === 0 || current.busy) return

      const provider = current.prompt?.provider
      if (provider === undefined || api === null) return

      const open = ticket.current
      const signIn =
        current.view === EAccountsView.ApiKey || open === null
          ? api.createAccount(apiKeyBody({ provider, apiKey: pasted }))
          : api.completeProviderSignIn({ attemptId: open.attemptId, code: pasted })

      put(working(current))
      void signIn
        .then(() => {
          ticket.current = null
          onChanged()
          refresh((next) => ({ ...backToList(next), notice: 'Signed in.' }))
        })
        .catch((failure: unknown) => failWith(reasonOf(failure)))
    },
    [api, failWith, onChanged, put, refresh],
  )

  const handleOpenUrl = useCallback(() => {
    const url = held.current?.prompt?.url
    if (url === undefined || url.length === 0) return
    openUrl(url)
  }, [held, openUrl])

  return {
    beginLogin,
    askForKey,
    runAction,
    confirmPick,
    submit,
    handleOpenUrl,
    clearTicket,
    stopPoll,
    stopBrowser,
  }
}
