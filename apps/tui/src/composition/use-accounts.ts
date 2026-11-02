import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useRef, useState } from 'react'

import { controlFailureNoteOf, controlOutcomeNoteOf } from '@dltech/atlas-client/transcript'
import {
  EAuthProvider,
  providerSpec,
  reachableProviders,
  type Account,
  type AccountId,
} from '@dltech/atlas-core'
import type { AccountsService, LoginTicket, UrlOpener } from '@dltech/atlas-harness'

import {
  acceptsApiKey,
  acceptsBrowserLogin,
  acceptsDeviceCode,
  acceptsPastedCode,
  askForApiKey,
  askForCode,
  backToActions,
  backToList,
  EAccountsView,
  EPickIntent,
  EProviderAction,
  failed,
  openAccounts,
  openLoginPicker,
  pickedAccount,
  providerRows,
  selectedAction,
  selectedRow,
  withRows,
  working,
  type AccountsState,
  type ProviderRow,
} from '../ui/accounts-model'
import { askForPause, clearedConfirm } from '../ui/accounts-pause-model'
import type { AccountsAvailability } from './use-accounts-availability'
import { useAccountsActions } from './use-accounts-actions'
import { useAccountsKeys } from './use-accounts-keys'
import { useBrowserLogin } from './use-browser-login'
import { useDeviceLogin } from './use-accounts-device'

export type AccountsControl = {
  state: AccountsState | null
  handleOpen: (notice?: string) => void
  handleDismiss: () => void
  handlePick: (row: ProviderRow) => void
  handleChooseAction: (actionIndex: number) => void
  handleChooseLogin: (accountIndex: number) => void
  handleKey: (key: KeyEvent) => void
  handleOpenUrl: () => void
  handleConfirmPause: () => void
  handleCancelPause: () => void
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

const signInUnsupported = (provider: EAuthProvider): string =>
  `${providerSpec(provider).label} takes an api key — choose it from the actions menu.`

const providerOf = (state: AccountsState): EAuthProvider | undefined => selectedRow(state)?.provider

/**
 * OpenTUI parses a whole input burst before React re-renders, so a pasted code arrives as a run of
 * key events that would all read the same rendered state. The ref is what the handlers read and
 * write; React state exists to draw it.
 */
export function useAccounts(args: {
  accounts: AccountsService
  openUrl: UrlOpener
  onAccounts?: (accounts: readonly Account[]) => void
  availability?: AccountsAvailability
}): AccountsControl {
  const { accounts, openUrl, onAccounts, availability } = args
  const held = useRef<AccountsState | null>(null)
  const [state, setState] = useState<AccountsState | null>(null)
  const ticket = useRef<LoginTicket | null>(null)

  const put = useCallback((next: AccountsState | null) => {
    held.current = next
    setState(next)
  }, [])

  const rows = useCallback(async (): Promise<readonly ProviderRow[]> => {
    const stored = await accounts.list()
    onAccounts?.(stored)

    const active: Partial<Record<EAuthProvider, AccountId | undefined>> = {}

    for (const spec of reachableProviders()) {
      active[spec.provider] = await accounts.activeFor(spec.provider)
    }

    const waiting = await availability?.waiting().catch(() => undefined)
    return providerRows({ accounts: stored, active, waiting })
  }, [accounts, availability, onAccounts])

  const handleOpen = useCallback(
    (notice?: string) => {
      void rows().then((loaded) =>
        put(openAccounts({ rows: loaded, ...(notice === undefined ? {} : { notice }) })),
      )
    },
    [put, rows],
  )

  const refresh = useCallback(
    (change: (state: AccountsState) => AccountsState = (current) => current) => {
      void rows().then((loaded) => {
        const current = held.current
        if (current === null) return

        put(change(withRows({ state: current, rows: loaded })))
      })
    },
    [put, rows],
  )

  const browser = useBrowserLogin({ accounts, openUrl, held, put, refresh })
  const device = useDeviceLogin({ accounts, openUrl, held, put, refresh })

  const handleDismiss = useCallback(() => {
    ticket.current = null
    device.stop()
    browser.cancel()
    put(null)
  }, [browser, device, put])

  const handlePick = useCallback(
    (row: ProviderRow) => {
      const current = held.current
      if (current === null) return

      const index = current.rows.findIndex((heldRow) => heldRow.provider === row.provider)
      if (index < 0) return

      put({ ...current, index })
    },
    [put],
  )

  const beginLogin = useCallback(
    (current: AccountsState) => {
      const provider = providerOf(current)
      if (provider === undefined) return

      if (acceptsBrowserLogin(provider)) {
        browser.begin({ state: current, provider })
        return
      }

      if (acceptsPastedCode(provider)) {
        try {
          const begun = accounts.begin(provider)
          ticket.current = begun
          put(askForCode({ state: current, prompt: { provider: begun.provider, url: begun.url } }))
          openUrl(begun.url)
        } catch (error) {
          put(failed({ state: current, reason: reasonOf(error) }))
        }
        return
      }

      if (!acceptsDeviceCode(provider)) {
        put(failed({ state: current, reason: signInUnsupported(provider) }))
        return
      }

      device.begin({ state: current, provider })
    },
    [accounts, browser, device, openUrl, put],
  )

  const askForKey = useCallback(
    (current: AccountsState) => {
      const provider = providerOf(current)
      if (provider === undefined || !acceptsApiKey(provider)) return

      put(askForApiKey({ state: current, provider }))
    },
    [put],
  )

  const {
    confirmPick,
    applyPause,
    handleConfirmPause,
    handleConfirmPauseClick,
    handleCancelPause,
    submit,
  } = useAccountsActions({
    accounts,
    availability,
    held,
    ticket,
    put,
    refresh,
  })

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
        return
      }
      if (action === EProviderAction.PauseAccount) {
        put(askForPause(current))
        return
      }
      if (action === EProviderAction.RemoveManualPause) applyPause({ current, paused: false })
    },
    [applyPause, askForKey, beginLogin, put],
  )

  const handleChooseAction = useCallback(
    (actionIndex: number) => {
      const current = held.current
      if (current === null) return

      runAction(current, selectedAction({ ...current, action: actionIndex }))
    },
    [runAction],
  )

  const handleChooseLogin = useCallback(
    (accountIndex: number) => {
      const current = held.current
      if (current === null) return

      confirmPick({ ...current, pick: accountIndex })
    },
    [confirmPick],
  )

  const handleOpenUrl = useCallback(() => {
    const current = held.current
    const url = current?.prompt?.url
    if (url === undefined || url.length === 0) return

    openUrl(url)
  }, [openUrl])

  const handleKey = useAccountsKeys({
    held,
    put,
    onDismiss: handleDismiss,
    onCancelPrompt: () => {
      ticket.current = null
      device.stop()
      browser.cancel()
    },
    onRunAction: runAction,
    onConfirmPick: confirmPick,
    onConfirmPause: handleConfirmPause,
    onSubmit: submit,
  })

  return useMemo(
    () => ({
      state,
      handleOpen,
      handleDismiss,
      handlePick,
      handleChooseAction,
      handleChooseLogin,
      handleKey,
      handleOpenUrl,
      handleConfirmPause: handleConfirmPauseClick,
      handleCancelPause,
    }),
    [
      handleChooseAction,
      handleChooseLogin,
      handleDismiss,
      handleKey,
      handleOpen,
      handleOpenUrl,
      handleConfirmPauseClick,
      handleCancelPause,
      handlePick,
      state,
    ],
  )
}
