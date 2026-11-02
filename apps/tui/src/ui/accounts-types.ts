import type { AccountAccess } from '@dltech/atlas-client/transcript'
import type { Account, AccountId, EAuthProvider } from '@dltech/atlas-core'

import type { PauseConfirm } from './accounts-pause-model'

export enum EAccountsView {
  List = 'list',
  Actions = 'actions',
  SwitchLogin = 'switch-login',
  PastedCode = 'pasted-code',
  DeviceCode = 'device-code',
  BrowserCode = 'browser-code',
  ApiKey = 'api-key',
  ConfirmPause = 'confirm-pause',
}

export enum EPickIntent {
  Use = 'use',
  Remove = 'remove',
}

export enum EProviderAction {
  SignIn = 'sign-in',
  AddApiKey = 'add-api-key',
  SwitchActive = 'switch-active',
  RemoveLogin = 'remove-login',
  PauseAccount = 'pause-account',
  RemoveManualPause = 'remove-manual-pause',
}

/**
 * The accounts drawer is a model-provider list: one row per provider Atlas can answer for, every
 * one optional. Logins live inside the provider — the detail panel shows the active one, the
 * modal manages the rest. A provider with no logins is still a row, since the sign-in flows are
 * reached through it. GitHub is not a model provider and lives in settings › cloud instead.
 */
export type ProviderRow = {
  provider: EAuthProvider
  accounts: readonly Account[]
  activeId: AccountId | undefined
  access?: AccountAccess | undefined
}

export type AccountsPrompt = {
  provider: EAuthProvider
  url: string
  userCode?: string | undefined
}

export type AccountsState = {
  view: EAccountsView
  index: number
  rows: readonly ProviderRow[]
  action: number
  pick: number
  pickIntent: EPickIntent
  prompt: AccountsPrompt | null
  typed: string
  notice: string | null
  failure: string | null
  busy: boolean
  confirm: PauseConfirm | null
}
