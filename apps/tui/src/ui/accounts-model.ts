import {
  EAccountStatus,
  EAuthProvider,
  ELoginFlow,
  providerSpec,
  type Account,
  type AccountId,
} from '@dltech/atlas-core'

export enum EAccountsView {
  List = 'list',
  Actions = 'actions',
  SwitchLogin = 'switch-login',
  PastedCode = 'pasted-code',
  DeviceCode = 'device-code',
  ApiKey = 'api-key',
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
}

const PROVIDER_ORDER: readonly EAuthProvider[] = [
  EAuthProvider.Anthropic,
  EAuthProvider.OpenAI,
  EAuthProvider.OpenRouter,
  EAuthProvider.Inference,
]

export function providerRows(args: {
  accounts: readonly Account[]
  active: Partial<Record<EAuthProvider, AccountId | undefined>>
}): readonly ProviderRow[] {
  const byProvider = new Map<EAuthProvider, Account[]>()
  for (const account of args.accounts) {
    byProvider.set(account.provider, [...(byProvider.get(account.provider) ?? []), account])
  }

  return PROVIDER_ORDER.map((provider) => ({
    provider,
    accounts: byProvider.get(provider) ?? [],
    activeId: args.active[provider],
  }))
}

export const activeOf = (row: ProviderRow): Account | undefined =>
  row.accounts.find((account) => account.id === row.activeId) ??
  row.accounts.find((account) => account.status === EAccountStatus.Active)

export const othersOf = (row: ProviderRow): readonly Account[] => {
  const active = activeOf(row)
  return row.accounts.filter((account) => account.id !== active?.id)
}

export const acceptsApiKey = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.ApiKey)

export const acceptsPastedCode = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.PastedCode)

export const acceptsDeviceCode = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.DeviceCode)

export function providerActions(row: ProviderRow): readonly EProviderAction[] {
  const actions: EProviderAction[] = []

  if (acceptsPastedCode(row.provider) || acceptsDeviceCode(row.provider)) {
    actions.push(EProviderAction.SignIn)
  }
  if (acceptsApiKey(row.provider)) actions.push(EProviderAction.AddApiKey)
  if (row.accounts.length > 1) actions.push(EProviderAction.SwitchActive)
  if (row.accounts.length > 0) actions.push(EProviderAction.RemoveLogin)

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
  state.view === EAccountsView.ApiKey
