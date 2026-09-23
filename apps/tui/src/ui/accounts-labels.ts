import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  ELoginFlow,
  providerSpec,
  type Account,
} from '@dltech/atlas-core'

import { EProviderAction } from './accounts-model'

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

export const signedOutDetail = (provider: EAuthProvider): string =>
  ['not signed in', signInFlows(provider).join(' or ')]
    .filter((part) => part.length > 0)
    .join(' · ')

const ACTION_LABEL: Readonly<Record<EProviderAction, string>> = {
  [EProviderAction.SignIn]: 'Sign in',
  [EProviderAction.AddApiKey]: 'Add an API key',
  [EProviderAction.SwitchActive]: 'Switch active login',
  [EProviderAction.RemoveLogin]: 'Remove a login',
}

export const actionLabel = (action: EProviderAction): string => ACTION_LABEL[action]

export const maskedKey = (typed: string): string =>
  typed.length <= 4 ? '•'.repeat(typed.length) : `${'•'.repeat(typed.length - 4)}${typed.slice(-4)}`
