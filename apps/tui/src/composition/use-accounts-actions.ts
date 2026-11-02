import { controlFailureNoteOf, controlOutcomeNoteOf } from '@dltech/atlas-client/transcript'
import { providerSpec, type Account } from '@dltech/atlas-core'
import type { AccountsService, LoginTicket } from '@dltech/atlas-harness'
import { useCallback, type RefObject } from 'react'

import {
  backToActions,
  backToList,
  EAccountsView,
  EPickIntent,
  failed,
  pickedAccount,
  selectedRow,
  working,
  type AccountsState,
} from '../ui/accounts-model'
import { clearedConfirm } from '../ui/accounts-pause-model'
import type { AccountsAvailability } from './use-accounts-availability'

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

export function useAccountsActions(args: {
  accounts: AccountsService
  availability: AccountsAvailability | undefined
  held: RefObject<AccountsState | null>
  ticket: RefObject<LoginTicket | null>
  put: (next: AccountsState | null) => void
  refresh: (change: (state: AccountsState) => AccountsState) => void
}) {
  const { accounts, availability, held, ticket, put, refresh } = args

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

      void accounts
        .remove(account.id)
        .then(() =>
          refresh((next) => ({ ...backToList(next), notice: `Removed ${account.label}.` })),
        )
    },
    [accounts, refresh],
  )

  const applyPause = useCallback(
    (args: { current: AccountsState; paused: boolean }) => {
      const row = selectedRow(args.current)
      const key = row?.access?.key
      const generation = row?.access?.generation
      const label = row?.accounts.find((account) => account.id === row.activeId)?.label
      if (availability === undefined || key == null || generation == null) return
      put(working(clearedConfirm(backToActions(args.current))))
      void availability
        .setPaused({ key, generation, paused: args.paused })
        .then((result) =>
          refresh((next) => ({
            ...backToList(clearedConfirm(next)),
            notice: `${label ?? 'Account'}: ${controlOutcomeNoteOf(result).text}`,
          })),
        )
        .catch((error: unknown) => {
          const now = held.current
          if (now !== null) {
            put(
              failed({
                state: clearedConfirm({ ...now, view: EAccountsView.List }),
                reason: controlFailureNoteOf(error).text,
              }),
            )
          }
        })
    },
    [availability, put, refresh],
  )

  const handleConfirmPause = useCallback(
    (current: AccountsState) => {
      if (current.busy) return
      applyPause({ current, paused: true })
    },
    [applyPause],
  )

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

  const handleConfirmPauseClick = useCallback(() => {
    const current = held.current
    if (current !== null && current.view === EAccountsView.ConfirmPause) handleConfirmPause(current)
  }, [handleConfirmPause, held])

  const handleCancelPause = useCallback(() => {
    const current = held.current
    if (current !== null) put(backToActions(clearedConfirm(current)))
  }, [held, put])

  return {
    confirmPick,
    applyPause,
    handleConfirmPause,
    handleConfirmPauseClick,
    handleCancelPause,
    submit,
  }
}
