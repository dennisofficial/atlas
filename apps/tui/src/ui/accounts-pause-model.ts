import {
  EAccountAccess,
  pauseConfirmationOf,
  type AccountAccess,
} from '@dltech/atlas-client/transcript'
import type { Account } from '@dltech/atlas-core'

import { EAccountsView, selectedRow, type AccountsState } from './accounts-model'

export type PauseConfirm = {
  account: Account
  access: AccountAccess
  title: string
  description: string
  confirmLabel: string
}

export const isPaused = (access: AccountAccess | undefined): boolean =>
  access?.access === EAccountAccess.Paused

export function askForPause(state: AccountsState): AccountsState {
  const row = selectedRow(state)
  const account = row?.accounts.find((entry) => entry.id === row.activeId)
  if (row === undefined || account === undefined || row.access === undefined) return state
  const copy = pauseConfirmationOf({ accountLabel: account.label, affected: row.access.affected })
  return {
    ...state,
    view: EAccountsView.ConfirmPause,
    failure: null,
    notice: null,
    confirm: { account, access: row.access, ...copy },
  }
}

export const clearedConfirm = (state: AccountsState): AccountsState => ({
  ...state,
  confirm: null,
})
