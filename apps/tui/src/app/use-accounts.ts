import type { KeyEvent, PasteEvent } from '@opentui/core'
import { usePaste } from '@opentui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  backspace,
  backToActions,
  backToList,
  EAccountsView,
  isPrompting,
  moveAction,
  movePick,
  moveSelection,
  openAccounts,
  openActions,
  selectedAction,
  typeInto,
  withRows,
  type AccountsState,
  type ProviderRow,
} from '../ui/accounts-model'
import { pastedText } from '../ui/pasted-text'
import { isPrintable, providerRowsOf, reasonOf } from './accounts-api'
import type { SessionApi } from './session-api'
import { useAccountFlows } from './use-account-flows'

export type AccountsControl = {
  state: AccountsState | null
  rows: readonly ProviderRow[]
  ready: boolean
  handleOpen: (notice?: string) => void
  handleDismiss: () => void
  handlePick: (row: ProviderRow) => void
  handleChooseAction: (actionIndex: number) => void
  handleChooseLogin: (accountIndex: number) => void
  handleKey: (key: KeyEvent) => void
  handleOpenUrl: () => void
  handleTyped: (text: string) => void
}

/**
 * OpenTUI parses a whole input burst before React re-renders, so a pasted code arrives as a run of
 * key events that would all read the same rendered state. The ref is what the handlers read and
 * write; React state exists to draw it.
 */
export function useAccounts(args: {
  api: SessionApi | null
  openUrl: (url: string) => void
  onChanged: () => void
  onProblem: (reason: string) => void
  minPollIntervalMs?: number | undefined
}): AccountsControl {
  const { api } = args
  const [state, setState] = useState<AccountsState | null>(null)
  const [rows, setRows] = useState<readonly ProviderRow[]>([])
  const [ready, setReady] = useState(false)
  const held = useRef<AccountsState | null>(null)
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem

  const put = useCallback((next: AccountsState | null) => {
    held.current = next
    setState(next)
  }, [])

  const load = useCallback(async (): Promise<readonly ProviderRow[]> => {
    const next = await providerRowsOf({ api })
    if (api !== null) {
      setRows(next)
      setReady(true)
    }
    return next
  }, [api])

  const reportLoad = useCallback((failure: unknown) => {
    problem.current(`could not load the accounts — ${reasonOf(failure)}`)
  }, [])

  useEffect(() => {
    let open = true
    void load().catch((failure: unknown) => {
      if (open) reportLoad(failure)
    })
    return () => {
      open = false
    }
  }, [load, reportLoad])

  const refresh = useCallback(
    (change: (state: AccountsState) => AccountsState = (current) => current) => {
      void load()
        .then((next) => {
          const current = held.current
          if (current === null) return
          put(change(withRows({ state: current, rows: next })))
        })
        .catch(reportLoad)
    },
    [load, put, reportLoad],
  )

  const flows = useAccountFlows({
    api,
    held,
    put,
    refresh,
    openUrl: args.openUrl,
    onChanged: args.onChanged,
    ...(args.minPollIntervalMs === undefined ? {} : { minPollIntervalMs: args.minPollIntervalMs }),
  })

  const handleOpen = useCallback(
    (notice?: string) => {
      void load()
        .then((next) =>
          put(openAccounts({ rows: next, ...(notice === undefined ? {} : { notice }) })),
        )
        .catch(reportLoad)
    },
    [load, put, reportLoad],
  )

  const handleDismiss = useCallback(() => {
    flows.clearTicket()
    flows.stopPoll()
    put(null)
  }, [flows, put])

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

  const handleChooseAction = useCallback(
    (actionIndex: number) => {
      const current = held.current
      if (current === null) return
      flows.runAction(current, selectedAction({ ...current, action: actionIndex }))
    },
    [flows],
  )

  const handleChooseLogin = useCallback(
    (accountIndex: number) => {
      const current = held.current
      if (current === null) return
      flows.confirmPick({ ...current, pick: accountIndex })
    },
    [flows],
  )

  const handleTyped = useCallback(
    (text: string) => {
      const current = held.current
      if (current === null || !isPrompting(current) || text.length === 0) return
      put(typeInto({ state: current, text }))
    },
    [put],
  )

  const handleKey = useCallback(
    (key: KeyEvent) => {
      const current = held.current
      if (current === null) return

      if (key.name === 'escape') {
        if (current.view === EAccountsView.List) {
          handleDismiss()
          return
        }
        if (current.view === EAccountsView.Actions) {
          put(backToList(current))
          return
        }
        if (current.view === EAccountsView.SwitchLogin) {
          put(backToActions(current))
          return
        }
        flows.clearTicket()
        flows.stopPoll()
        put(backToList(current))
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        const delta = key.name === 'up' ? -1 : 1
        if (current.view === EAccountsView.List) put(moveSelection({ state: current, delta }))
        else if (current.view === EAccountsView.Actions) put(moveAction({ state: current, delta }))
        else if (current.view === EAccountsView.SwitchLogin)
          put(movePick({ state: current, delta }))
        return
      }

      if (key.name !== 'return') {
        if (!isPrompting(current)) return
        if (key.name === 'backspace') {
          put(backspace(current))
          return
        }
        if (isPrintable(key)) put(typeInto({ state: current, text: key.sequence ?? '' }))
        return
      }

      if (current.view === EAccountsView.List) {
        put(openActions(current))
        return
      }
      if (current.view === EAccountsView.Actions) {
        flows.runAction(current, selectedAction(current))
        return
      }
      if (current.view === EAccountsView.SwitchLogin) {
        flows.confirmPick(current)
        return
      }
      flows.submit(current)
    },
    [flows, handleDismiss, put],
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
      rows,
      ready,
      handleOpen,
      handleDismiss,
      handlePick,
      handleChooseAction,
      handleChooseLogin,
      handleKey,
      handleOpenUrl: flows.handleOpenUrl,
      handleTyped,
    }),
    [
      flows.handleOpenUrl,
      handleChooseAction,
      handleChooseLogin,
      handleDismiss,
      handleKey,
      handleOpen,
      handlePick,
      handleTyped,
      ready,
      rows,
      state,
    ],
  )
}
