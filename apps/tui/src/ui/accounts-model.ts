import {
  EAuthProvider,
  reachableProviders,
  type Account,
  type AccountId,
} from '@dltech/atlas-core'

export enum EAccountsView {
  List = 'list',
  PastedCode = 'pasted-code',
  DeviceCode = 'device-code',
  CloudDevice = 'cloud-device',
  ApiKey = 'api-key',
}

export const ACCOUNT_ROWS = 4

export type AccountsWindow = {
  start: number
  visible: readonly AccountRow[]
  below: number
}

export enum EAccountRow {
  Account = 'account',
  SignedOut = 'signed-out',
  Cloud = 'cloud',
}

export type CloudIdentity = { email: string | null }

/**
 * A provider Atlas can answer for but nothing has signed into still gets a row, because the sign-in
 * flows are reached by selecting one. The cloud row leads the list whether or not a session exists,
 * because both signing in and signing out are reached by selecting it. Discriminated rather than
 * optional so every reader that wants an account id has to say what it does without one.
 */
export type AccountRow =
  | { kind: EAccountRow.Account; account: Account; active: boolean }
  | { kind: EAccountRow.SignedOut; provider: EAuthProvider; active: false }
  | { kind: EAccountRow.Cloud; session: CloudIdentity | null; active: false }

export const rowProvider = (row: AccountRow): EAuthProvider | undefined => {
  if (row.kind === EAccountRow.Cloud) return undefined
  return row.kind === EAccountRow.Account ? row.account.provider : row.provider
}

export const accountOf = (row: AccountRow): Account | undefined =>
  row.kind === EAccountRow.Account ? row.account : undefined

export const rowKey = (row: AccountRow): string => {
  if (row.kind === EAccountRow.Cloud) return 'cloud'
  return row.kind === EAccountRow.Account ? String(row.account.id) : `signed-out:${row.provider}`
}

export type AccountsPrompt = {
  provider: EAuthProvider
  url: string
  userCode?: string | undefined
}

export type CloudPrompt = {
  url: string
  userCode: string
}

export type AccountsState = {
  view: EAccountsView
  index: number
  rows: readonly AccountRow[]
  prompt: AccountsPrompt | null
  cloudPrompt: CloudPrompt | null
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

const rank = (row: AccountRow): number => {
  const provider = rowProvider(row)
  if (provider === undefined) return -1

  const at = PROVIDER_ORDER.indexOf(provider)
  return at < 0 ? PROVIDER_ORDER.length : at
}

const placement = (row: AccountRow): number => (row.kind === EAccountRow.Account ? 0 : 1)

const openedAt = (row: AccountRow): string => accountOf(row)?.createdAt ?? ''

export function accountRows(args: {
  accounts: readonly Account[]
  active: Partial<Record<EAuthProvider, AccountId | undefined>>
  cloud: CloudIdentity | null
}): readonly AccountRow[] {
  const held = new Set(args.accounts.map((account) => account.provider))

  const rows: AccountRow[] = [
    ...args.accounts.map((account) => ({
      kind: EAccountRow.Account as const,
      account,
      active: args.active[account.provider] === account.id,
    })),
    ...reachableProviders()
      .filter((spec) => !held.has(spec.provider))
      .map((spec) => ({
        kind: EAccountRow.SignedOut as const,
        provider: spec.provider,
        active: false as const,
      })),
  ]

  const cloudRow: AccountRow = { kind: EAccountRow.Cloud, session: args.cloud, active: false }

  return [
    cloudRow,
    ...rows.sort(
      (left, right) =>
        rank(left) - rank(right) ||
        placement(left) - placement(right) ||
        openedAt(left).localeCompare(openedAt(right)),
    ),
  ]
}

export function openAccounts(args: {
  rows: readonly AccountRow[]
  notice?: string | null
}): AccountsState {
  const active = args.rows.findIndex((row) => row.active)

  return {
    view: EAccountsView.List,
    index: active < 0 ? 0 : active,
    rows: args.rows,
    prompt: null,
    cloudPrompt: null,
    typed: '',
    notice: args.notice ?? null,
    failure: null,
    busy: false,
  }
}

export function withRows(args: {
  state: AccountsState
  rows: readonly AccountRow[]
}): AccountsState {
  const index = Math.min(args.state.index, Math.max(0, args.rows.length - 1))
  return { ...args.state, rows: args.rows, index }
}

export function moveSelection(args: { state: AccountsState; delta: number }): AccountsState {
  if (args.state.rows.length === 0) return args.state

  const last = args.state.rows.length - 1
  const index = Math.min(last, Math.max(0, args.state.index + Math.trunc(args.delta)))

  return { ...args.state, index }
}

export const selectedRow = (state: AccountsState): AccountRow | undefined => state.rows[state.index]

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

export function askForCloudCode(args: {
  state: AccountsState
  prompt?: CloudPrompt | undefined
}): AccountsState {
  return {
    ...args.state,
    view: EAccountsView.CloudDevice,
    cloudPrompt: args.prompt ?? null,
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
  return { ...state, view: EAccountsView.List, prompt: null, cloudPrompt: null, typed: '', busy: false }
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

export const isPrompting = (state: AccountsState): boolean => state.view !== EAccountsView.List

/**
 * A bottom drawer is as tall as its body asks for, and an account costs three rows, so the list
 * bounds itself rather than growing up the screen. The window follows the mark.
 */
export function accountsWindow(args: { state: AccountsState; rows: number }): AccountsWindow {
  const rows = Math.max(1, Math.trunc(args.rows))
  const all = args.state.rows
  if (all.length <= rows) return { start: 0, visible: all, below: 0 }

  const start = Math.min(Math.max(0, args.state.index - rows + 1), all.length - rows)

  return { start, visible: all.slice(start, start + rows), below: all.length - start - rows }
}
