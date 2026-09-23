import type { KeyEvent, PasteEvent } from '@opentui/core'
import { usePaste } from '@opentui/react'
import { useCallback, useMemo, useRef, useState } from 'react'

import {
  EAuthProvider,
  providerSpec,
  reachableProviders,
  type Account,
  type AccountId,
} from '@dltech/atlas-core'
import type {
  AccountsService,
  DeviceTicket,
  LoginTicket,
  UrlOpener,
} from '@dltech/atlas-harness'
import { EDevicePoll } from '@dltech/atlas-harness'

import {
  acceptsApiKey,
  acceptsDeviceCode,
  acceptsPastedCode,
  askForApiKey,
  askForCode,
  askForDeviceCode,
  backspace,
  backToActions,
  backToList,
  EAccountsView,
  EPickIntent,
  EProviderAction,
  failed,
  isPrompting,
  moveAction,
  movePick,
  moveSelection,
  openAccounts,
  openActions,
  openLoginPicker,
  pickedAccount,
  providerRows,
  selectedAction,
  selectedRow,
  typeInto,
  withRows,
  working,
  type AccountsState,
  type ProviderRow,
} from '../ui/accounts-model'
import { pastedText } from '../ui/pasted-text'

export type AccountsControl = {
  state: AccountsState | null
  handleOpen: (notice?: string) => void
  handleDismiss: () => void
  handlePick: (row: ProviderRow) => void
  handleChooseAction: (actionIndex: number) => void
  handleChooseLogin: (accountIndex: number) => void
  handleKey: (key: KeyEvent) => void
  handleOpenUrl: () => void
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

const isPrintable = (key: KeyEvent): boolean => {
  const sequence = key.sequence ?? ''
  return sequence.length > 0 && !key.ctrl && !key.meta && !/[\u0000-\u001f]/.test(sequence)
}

const signInUnsupported = (provider: EAuthProvider): string =>
  `${providerSpec(provider).label} takes an api key — choose it from the actions menu.`

const providerOf = (state: AccountsState): EAuthProvider | undefined =>
  selectedRow(state)?.provider

/**
 * OpenTUI parses a whole input burst before React re-renders, so a pasted code arrives as a run of
 * key events that would all read the same rendered state. The ref is what the handlers read and
 * write; React state exists to draw it.
 */
export function useAccounts(args: {
  accounts: AccountsService
  openUrl: UrlOpener
  onAccounts?: (accounts: readonly Account[]) => void
}): AccountsControl {
  const { accounts, openUrl, onAccounts } = args
  const held = useRef<AccountsState | null>(null)
  const [state, setState] = useState<AccountsState | null>(null)
  const ticket = useRef<LoginTicket | null>(null)
  const device = useRef<{ ticket: DeviceTicket; deadline: number } | null>(null)
  const deviceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

    return providerRows({ accounts: stored, active })
  }, [accounts, onAccounts])

  const handleOpen = useCallback(
    (notice?: string) => {
      void rows().then((loaded) =>
        put(openAccounts({ rows: loaded, ...(notice === undefined ? {} : { notice }) })),
      )
    },
    [put, rows],
  )

  const stopDevice = useCallback(() => {
    device.current = null
    if (deviceTimer.current !== null) clearTimeout(deviceTimer.current)
    deviceTimer.current = null
  }, [])

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

  const handleDismiss = useCallback(() => {
    ticket.current = null
    stopDevice()
    put(null)
  }, [put, stopDevice])

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

  /**
   * The device code's clock keeps ticking while the drawer is open, so the poll re-reads the held
   * state rather than trusting a closure — an escape or a re-render mid-poll must stop it.
   */
  const pollDevice = useCallback(() => {
    const open = device.current
    const current = held.current
    if (open === null || current === null || current.view !== EAccountsView.DeviceCode) return

    if (Date.now() > open.deadline) {
      stopDevice()
      put(failed({ state: current, reason: 'that code expired — start again from actions.' }))
      return
    }

    void accounts
      .pollDevice(open.ticket)
      .then((result) => {
        const now = held.current
        if (now === null || now.view !== EAccountsView.DeviceCode) return

        if (result.status === EDevicePoll.Pending) {
          deviceTimer.current = setTimeout(pollDevice, Math.max(open.ticket.intervalMs, 3000))
          return
        }

        stopDevice()
        refresh((next) => ({
          ...backToList(next),
          notice: `Signed in as ${result.account.label}.`,
        }))
      })
      .catch((error: unknown) => {
        stopDevice()
        const now = held.current
        if (now !== null) put(failed({ state: now, reason: reasonOf(error) }))
      })
  }, [accounts, put, refresh, stopDevice])

  const beginDevice = useCallback(
    (current: AccountsState, provider: EAuthProvider) => {
      put(askForDeviceCode({ state: current, prompt: { provider, url: '' } }))

      void accounts
        .beginDevice(provider)
        .then((begun) => {
          const now = held.current
          if (now === null || now.view !== EAccountsView.DeviceCode) return

          device.current = { ticket: begun, deadline: Date.now() + begun.expiresInMs }
          put(
            askForDeviceCode({
              state: now,
              prompt: { provider: begun.provider, url: begun.verificationUrl, userCode: begun.userCode },
            }),
          )
          openUrl(begun.verificationUrl)
          deviceTimer.current = setTimeout(pollDevice, Math.max(begun.intervalMs, 3000))
        })
        .catch((error: unknown) => {
          const now = held.current
          if (now !== null) put(failed({ state: now, reason: reasonOf(error) }))
        })
    },
    [accounts, openUrl, pollDevice, put],
  )

  const beginLogin = useCallback(
    (current: AccountsState) => {
      const provider = providerOf(current)
      if (provider === undefined) return

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

      beginDevice(current, provider)
    },
    [accounts, beginDevice, openUrl, put],
  )

  const askForKey = useCallback(
    (current: AccountsState) => {
      const provider = providerOf(current)
      if (provider === undefined || !acceptsApiKey(provider)) return

      put(askForApiKey({ state: current, provider }))
    },
    [put],
  )

  const confirmPick = useCallback(
    (current: AccountsState) => {
      const account = pickedAccount(current)
      if (account === undefined) return

      if (current.pickIntent === EPickIntent.Use) {
        void accounts.use({ provider: account.provider, accountId: account.id }).then(() =>
          refresh((next) => ({
            ...backToList(next),
            notice: `Active ${providerSpec(account.provider).label} login: ${account.label}.`,
          })),
        )
        return
      }

      void accounts.remove(account.id).then(() =>
        refresh((next) => ({ ...backToList(next), notice: `Removed ${account.label}.` })),
      )
    },
    [accounts, refresh],
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

  const submit = useCallback(
    (current: AccountsState) => {
      const pasted = current.typed.trim()
      if (pasted.length === 0 || current.busy) return

      const open = ticket.current
      const provider = current.prompt?.provider
      if (provider === undefined) return

      const signIn: Promise<Account> =
        current.view === EAccountsView.ApiKey || open === null
          ? accounts.addApiKey({ provider, apiKey: pasted })
          : accounts.complete({ ticket: open, pasted })

      put(working(current))

      void signIn
        .then((account) => {
          ticket.current = null
          refresh((next) => ({ ...backToList(next), notice: `Signed in as ${account.label}.` }))
        })
        .catch((error: unknown) => {
          const next = held.current
          if (next !== null) put(failed({ state: next, reason: reasonOf(error) }))
        })
    },
    [accounts, put, refresh],
  )

  const handleListKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        handleDismiss()
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        put(moveSelection({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'return') put(openActions(current))
    },
    [handleDismiss, put],
  )

  const handleActionsKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        put(backToList(current))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        put(moveAction({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'return') runAction(current, selectedAction(current))
    },
    [put, runAction],
  )

  const handlePickerKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        put(backToActions(current))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        put(movePick({ state: current, delta: key.name === 'up' ? -1 : 1 }))
        return
      }

      if (key.name === 'return') confirmPick(current)
    },
    [confirmPick, put],
  )

  const handlePromptKey = useCallback(
    (key: KeyEvent, current: AccountsState) => {
      if (key.name === 'escape') {
        ticket.current = null
        stopDevice()
        put(backToList(current))
        return
      }

      if (current.view === EAccountsView.DeviceCode) return

      if (key.name === 'return') {
        submit(current)
        return
      }

      if (key.name === 'backspace') {
        put(backspace(current))
        return
      }

      if (isPrintable(key)) put(typeInto({ state: current, text: key.sequence ?? '' }))
    },
    [put, stopDevice, submit],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      const current = held.current
      if (current === null) return

      if (current.view === EAccountsView.List) {
        handleListKey(key, current)
        return
      }

      if (current.view === EAccountsView.Actions) {
        handleActionsKey(key, current)
        return
      }

      if (current.view === EAccountsView.SwitchLogin) {
        handlePickerKey(key, current)
        return
      }

      handlePromptKey(key, current)
    },
    [handleActionsKey, handleListKey, handlePickerKey, handlePromptKey],
  )

  usePaste(
    useCallback(
      (event: PasteEvent) => {
        const current = held.current
        if (current === null || !isPrompting(current)) return

        const pasted = pastedText(event)
        if (pasted.length === 0) return

        event.preventDefault()
        event.stopPropagation()
        put(typeInto({ state: current, text: pasted }))
      },
      [put],
    ),
  )

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
    }),
    [
      handleChooseAction,
      handleChooseLogin,
      handleDismiss,
      handleKey,
      handleOpen,
      handleOpenUrl,
      handlePick,
      state,
    ],
  )
}
