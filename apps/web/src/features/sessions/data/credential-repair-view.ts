import {
  EAuthKind,
  EProviderFailureKind,
  ERunFailureKind,
  ERepairAction,
  type CredentialRepair,
  type RunFailureAgent,
} from '@dltech/atlas-core'
import type { SessionRetryInput } from '@dltech/atlas-protocol'
import { EOauthProvider } from '@dltech/atlas-wire/web'

import type { Account } from '@/features/settings/data/personal/accounts-api'
import { EProviderId } from '@/features/settings/fixtures/settings-agent'

export type RepairActionSpec = {
  id: string
  action: ERepairAction
  label: string
  detail?: string
  accountId?: string
}

export type RepairCardView = {
  title: string
  detail: string
  notes: readonly string[]
}

const PROVIDER_IDS = [
  EProviderId.Anthropic,
  EProviderId.OpenAI,
  EProviderId.OpenRouter,
  EProviderId.Inference,
  EProviderId.Gateway,
  EProviderId.Typesafe,
] as const satisfies readonly EProviderId[]

const OAUTH_PROVIDERS: readonly EOauthProvider[] = [EOauthProvider.Anthropic, EOauthProvider.OpenAI]

const ACTION_LABELS: Readonly<Record<ERepairAction, string>> = {
  [ERepairAction.ReSignIn]: 'Re-sign in',
  [ERepairAction.ReplaceKey]: 'Replace key',
  [ERepairAction.SwapAccount]: 'Use another account',
  [ERepairAction.SwapModel]: 'Switch model',
  [ERepairAction.CheckAgain]: 'Check again',
}

const SWAP_DETAIL = 'New sessions will use it too.'

const REASON_COPY: Readonly<Record<string, string>> = {
  [ERunFailureKind.Auth]: 'The sign-in is no longer accepted',
  [ERunFailureKind.Quota]: 'The plan or credit limit is used up',
  [ERunFailureKind.MissingCredential]: 'No credential is saved',
  [ERunFailureKind.Delivery]: 'The provider refused the request',
  [EProviderFailureKind.RateLimited]: 'The provider is rate limiting',
  [EProviderFailureKind.Overloaded]: 'The provider is overloaded',
  [EProviderFailureKind.Network]: 'The provider could not be reached',
}

export const providerRootOf = (providerId: string): string => providerId.split('.')[0] ?? providerId

export const providerIdOf = (providerId: string | null): EProviderId | null => {
  if (providerId === null) return null
  const root = providerRootOf(providerId)
  return PROVIDER_IDS.find((id) => id === root) ?? null
}

export const oauthProviderOf = (providerId: string | null): EOauthProvider | null => {
  if (providerId === null) return null
  const root = providerRootOf(providerId)
  return OAUTH_PROVIDERS.find((id) => id === root) ?? null
}

export const accountKindOf = (kind: string): EAuthKind | null => {
  if (kind === EAuthKind.Oauth) return EAuthKind.Oauth
  if (kind === EAuthKind.ApiKey) return EAuthKind.ApiKey
  return null
}

export function otherAccountsOf(args: {
  accounts: readonly Account[]
  providerId: string | null
  accountId: string | null
}): readonly Account[] {
  if (args.providerId === null) return []
  const root = providerRootOf(args.providerId)
  return args.accounts.filter(
    (account) =>
      account.provider === root && account.id !== args.accountId && account.status !== 'expired',
  )
}

export function repairActionSpecsOf(args: {
  actions: readonly ERepairAction[]
  otherAccounts: readonly Account[]
}): readonly RepairActionSpec[] {
  return args.actions.flatMap((action): RepairActionSpec[] => {
    if (action === ERepairAction.SwapAccount) {
      return args.otherAccounts.map((account) => ({
        id: `${ERepairAction.SwapAccount}:${account.id}`,
        action,
        label: `Use ${account.label}`,
        detail: SWAP_DETAIL,
        accountId: account.id,
      }))
    }
    return [{ id: action, action, label: ACTION_LABELS[action] }]
  })
}

export function retryTargetsOf(args: {
  repair: CredentialRepair
  sessionId: string
}): readonly SessionRetryInput[] {
  const main: SessionRetryInput[] = args.repair.main ? [{ sessionId: args.sessionId }] : []
  const agents: SessionRetryInput[] = args.repair.agents.map((agent) => ({
    sessionId: args.sessionId,
    agentId: agent.agentId,
  }))
  return [...main, ...agents]
}

const reasonCopyOf = (repair: CredentialRepair): string =>
  REASON_COPY[repair.reason ?? repair.kind] ?? 'The provider call failed'

const modelLabelOf = (modelId: string | null): string => modelId ?? 'the model'

export const repairTitleOf = (repair: CredentialRepair): string =>
  repair.main
    ? `Atlas could not call ${modelLabelOf(repair.modelId)}`
    : `A sub-agent could not call ${modelLabelOf(repair.modelId)}`

const resetsAtOf = (resetAt: string | null): string | undefined => {
  if (resetAt === null) return undefined
  const at = new Date(resetAt)
  if (Number.isNaN(at.getTime())) return undefined
  return `Resets at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

const noteOf = (agent: RunFailureAgent): string =>
  `Waiting: ${agent.agentType === '' ? 'sub-agent' : agent.agentType} — ${agent.intent}`

const actionDetailsOf = (actions: readonly RepairActionSpec[]): readonly string[] => {
  const details = actions.flatMap((action) => (action.detail === undefined ? [] : [action.detail]))
  return [...new Set(details)]
}

export function repairCardViewOf(args: {
  repair: CredentialRepair
  providerLabel: string | undefined
  accountLabel: string | undefined
  actions?: readonly RepairActionSpec[] | undefined
}): RepairCardView {
  const parts = [args.providerLabel, args.accountLabel, reasonCopyOf(args.repair)]
  const resets = resetsAtOf(args.repair.resetAt)
  if (resets !== undefined) parts.push(resets)
  return {
    title: repairTitleOf(args.repair),
    detail: parts.filter((part): part is string => part !== undefined && part !== '').join(' · '),
    notes: [...args.repair.agents.map(noteOf), ...actionDetailsOf(args.actions ?? [])],
  }
}
