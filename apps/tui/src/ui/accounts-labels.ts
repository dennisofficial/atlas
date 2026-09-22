import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  ELoginFlow,
  providerSpec,
  type Account,
} from '@dltech/atlas-core'

import { EAccountRow, type AccountRow } from './accounts-model'

export const kindLabel = (account: Account): string =>
  account.kind === EAuthKind.ApiKey ? 'api key' : 'subscription'

export const originLabel = (account: Account): string | null => {
  if (account.origin === EAccountOrigin.Imported) return 'imported'
  if (account.origin === EAccountOrigin.Environment) return 'from the environment'
  return null
}

export const statusLabel = (account: Account): string | null =>
  account.status === EAccountStatus.Active ? null : account.status

export const availabilityLabel = (account: Account): string | null =>
  providerSpec(account.provider).reachable ? null : 'no adapter yet'

export function accountDetail(account: Account): string {
  const parts = [
    providerSpec(account.provider).label,
    availabilityLabel(account),
    kindLabel(account),
    originLabel(account),
    statusLabel(account),
  ]

  return parts.filter((part): part is string => part !== null).join(' · ')
}

const FLOW_LABEL: Readonly<Record<ELoginFlow, string>> = {
  [ELoginFlow.PastedCode]: 'sign in',
  [ELoginFlow.DeviceCode]: 'sign in',
  [ELoginFlow.ApiKey]: 'api key',
}

export const signInFlows = (provider: EAuthProvider): readonly string[] => [
  ...new Set(providerSpec(provider).logins.map((flow) => FLOW_LABEL[flow])),
]

export const acceptsApiKey = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.ApiKey)

export const acceptsPastedCode = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.PastedCode)

export const acceptsDeviceCode = (provider: EAuthProvider): boolean =>
  providerSpec(provider).logins.includes(ELoginFlow.DeviceCode)

const signedOutDetail = (provider: EAuthProvider): string =>
  ['not signed in', signInFlows(provider).join(' or ')]
    .filter((part) => part.length > 0)
    .join(' · ')

const githubDetail = (row: Extract<AccountRow, { kind: EAccountRow.Github }>): string => {
  if (row.github.unreachable) return "couldn't reach Atlas Cloud"
  if (row.github.connection === null) return 'not connected · enter to connect'
  return `@${row.github.connection.login} · press x to disconnect`
}

export const rowLabel = (row: AccountRow): string => {
  if (row.kind === EAccountRow.Github) return 'GitHub'
  return row.kind === EAccountRow.Account ? row.account.label : providerSpec(row.provider).label
}

export const rowDetail = (row: AccountRow): string => {
  if (row.kind === EAccountRow.Github) return githubDetail(row)
  return row.kind === EAccountRow.Account ? accountDetail(row.account) : signedOutDetail(row.provider)
}

export const maskedKey = (typed: string): string =>
  typed.length <= 4 ? '•'.repeat(typed.length) : `${'•'.repeat(typed.length - 4)}${typed.slice(-4)}`
