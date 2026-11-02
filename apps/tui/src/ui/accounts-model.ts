import {
  accountAccessOf,
  EAccountAccess,
  type AccountAccess,
} from '@dltech/atlas-client/transcript'
import {
  EAccountStatus,
  EAuthProvider,
  type Account,
  type AccountId,
  type WaitingForModel,
} from '@dltech/atlas-core'

import {
  acceptsApiKey,
  acceptsBrowserLogin,
  acceptsDeviceCode,
  acceptsPastedCode,
} from './accounts-flows'
import {
  EAccountsView,
  EPickIntent,
  EProviderAction,
  type AccountsPrompt,
  type AccountsState,
  type ProviderRow,
} from './accounts-types'

export * from './accounts-types'

const PROVIDER_ORDER: readonly EAuthProvider[] = [
  EAuthProvider.Anthropic,
  EAuthProvider.OpenAI,
  EAuthProvider.OpenRouter,
  EAuthProvider.Inference,
]

export function providerRows(args: {
  accounts: readonly Account[]
  active: Partial<Record<EAuthProvider, AccountId | undefined>>
  waiting?: readonly WaitingForModel[] | undefined
}): readonly ProviderRow[] {
  const byProvider = new Map<EAuthProvider, Account[]>()
  for (const account of args.accounts) {
    byProvider.set(account.provider, [...(byProvider.get(account.provider) ?? []), account])
  }

  return PROVIDER_ORDER.map((provider) => {
    const row: ProviderRow = {
      provider,
      accounts: byProvider.get(provider) ?? [],
      activeId: args.active[provider],
    }
    const lead = activeOf(row)
    if (args.waiting === undefined || lead === undefined) return row
    return { ...row, access: accountAccessOf({ accountId: lead.id, waiting: args.waiting }) }
  })
}

export const activeOf = (row: ProviderRow): Account | undefined =>
  row.accounts.find((account) => account.id === row.activeId) ??
  row.accounts.find((account) => account.status === EAccountStatus.Active)

export const othersOf = (row: ProviderRow): readonly Account[] => {
  const active = activeOf(row)
  return row.accounts.filter((account) => account.id !== active?.id)
}

export {
  acceptsApiKey,
  acceptsBrowserLogin,
  acceptsDeviceCode,
  acceptsPastedCode,
} from './accounts-flows'

export function providerActions(row: ProviderRow): readonly EProviderAction[] {
  const actions: EProviderAction[] = []

  const signsIn =
    acceptsBrowserLogin(row.provider) ||
    acceptsPastedCode(row.provider) ||
    acceptsDeviceCode(row.provider)

  if (signsIn) {
    actions.push(EProviderAction.SignIn)
  }
  if (acceptsApiKey(row.provider)) actions.push(EProviderAction.AddApiKey)
  if (row.accounts.length > 1) actions.push(EProviderAction.SwitchActive)
  if (row.accounts.length > 0) actions.push(EProviderAction.RemoveLogin)
  if (row.access?.key != null) {
    actions.push(
      row.access.access === EAccountAccess.Paused
        ? EProviderAction.RemoveManualPause
        : EProviderAction.PauseAccount,
    )
  }

  return actions
}

export function openAccounts(args: {
  rows: readonly ProviderRow[]
  notice?: string | null
}): AccountsState {
  const active = args.rows.findIndex((row) => activeOf(row) !== undefined)

  return {
    view: EAccountsView.List,
    index: active < 0 ? 0 : active,
    rows: args.rows,
    action: 0,
    pick: 0,
    pickIntent: EPickIntent.Use,
    prompt: null,
    typed: '',
    notice: args.notice ?? null,
    failure: null,
    busy: false,
    confirm: null,
  }
}

export function withRows(args: {
  state: AccountsState
  rows: readonly ProviderRow[]
}): AccountsState {
  const index = Math.min(args.state.index, Math.max(0, args.rows.length - 1))
  return { ...args.state, rows: args.rows, index }
}

const clamp = (value: number, last: number): number => Math.min(last, Math.max(0, value))

export function moveSelection(args: { state: AccountsState; delta: number }): AccountsState {
  if (args.state.rows.length === 0) return args.state

  return {
    ...args.state,
    index: clamp(args.state.index + Math.trunc(args.delta), args.state.rows.length - 1),
  }
}

export const selectedRow = (state: AccountsState): ProviderRow | undefined =>
  state.rows[state.index]

export function openActions(state: AccountsState): AccountsState {
  const row = selectedRow(state)
  if (row === undefined || providerActions(row).length === 0) return state

  return { ...state, view: EAccountsView.Actions, action: 0, failure: null, notice: null }
}

export function moveAction(args: { state: AccountsState; delta: number }): AccountsState {
  const row = selectedRow(args.state)
  if (row === undefined) return args.state

  return {
    ...args.state,
    action: clamp(args.state.action + Math.trunc(args.delta), providerActions(row).length - 1),
  }
}

export function selectedAction(state: AccountsState): EProviderAction | undefined {
  const row = selectedRow(state)
  if (row === undefined) return undefined

  return providerActions(row)[state.action]
}

export function openLoginPicker(args: {
  state: AccountsState
  intent: EPickIntent
}): AccountsState {
  const row = selectedRow(args.state)
  if (row === undefined || row.accounts.length === 0) return args.state

  return { ...args.state, view: EAccountsView.SwitchLogin, pick: 0, pickIntent: args.intent }
}

export function movePick(args: { state: AccountsState; delta: number }): AccountsState {
  const row = selectedRow(args.state)
  if (row === undefined) return args.state

  return {
    ...args.state,
    pick: clamp(args.state.pick + Math.trunc(args.delta), row.accounts.length - 1),
  }
}

export function pickedAccount(state: AccountsState): Account | undefined {
  const row = selectedRow(state)
  if (row === undefined) return undefined

  return row.accounts[state.pick]
}

export function backToActions(state: AccountsState): AccountsState {
  return { ...state, view: EAccountsView.Actions, failure: null }
}

export function askForCode(args: { state: AccountsState; prompt: AccountsPrompt }): AccountsState {
  return {
    ...args.state,
    view: EAccountsView.PastedCode,
    prompt: args.prompt,
    typed: '',
    failure: null,
    notice: null,
  }
}

export function askForDeviceCode(args: {
  state: AccountsState
  prompt: AccountsPrompt
}): AccountsState {
  return {
    ...args.state,
    view: EAccountsView.DeviceCode,
    prompt: args.prompt,
    typed: '',
    failure: null,
    notice: null,
    busy: false,
  }
}

export function askForBrowser(args: {
  state: AccountsState
  prompt: AccountsPrompt
}): AccountsState {
  return { ...askForDeviceCode(args), view: EAccountsView.BrowserCode }
}

export function askForApiKey(args: {
  state: AccountsState
  provider: EAuthProvider
}): AccountsState {
  return {
    ...args.state,
    view: EAccountsView.ApiKey,
    prompt: { provider: args.provider, url: '' },
    typed: '',
    failure: null,
    notice: null,
  }
}

export function typeInto(args: { state: AccountsState; text: string }): AccountsState {
  return { ...args.state, typed: `${args.state.typed}${args.text}`, failure: null }
}

export function backspace(state: AccountsState): AccountsState {
  return { ...state, typed: state.typed.slice(0, -1) }
}

export function backToList(state: AccountsState): AccountsState {
  return { ...state, prompt: null, view: EAccountsView.List, typed: '', busy: false }
}

export function working(state: AccountsState): AccountsState {
  return { ...state, busy: true, failure: null }
}

export function failed(args: { state: AccountsState; reason: string }): AccountsState {
  return { ...args.state, busy: false, failure: args.reason }
}

export function announced(args: { state: AccountsState; notice: string }): AccountsState {
  return { ...args.state, notice: args.notice, failure: null }
}

export const isPrompting = (state: AccountsState): boolean =>
  state.view === EAccountsView.PastedCode ||
  state.view === EAccountsView.DeviceCode ||
  state.view === EAccountsView.BrowserCode ||
  state.view === EAccountsView.ApiKey
