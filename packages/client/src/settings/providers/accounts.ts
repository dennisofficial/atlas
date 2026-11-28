import { EAuthProvider } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { shortDate } from '../account/relative-time'
import { EProviderId, PROVIDER_CATALOGUE, type ProviderInfo } from './catalogue'

export enum EAccountKind {
  Oauth = 'oauth',
  ApiKey = 'api-key',
}

export const DEFAULT_API_KEY_LABEL = 'API key'
export const AUTH_PROVIDER_OF: Record<EProviderId, EAuthProvider> = {
  [EProviderId.Anthropic]: EAuthProvider.Anthropic,
  [EProviderId.OpenAI]: EAuthProvider.OpenAI,
  [EProviderId.OpenRouter]: EAuthProvider.OpenRouter,
  [EProviderId.Inference]: EAuthProvider.Inference,
  [EProviderId.Gateway]: EAuthProvider.Gateway,
  [EProviderId.Typesafe]: EAuthProvider.Typesafe,
}

export const providerAccountSchema = z.object({
  id: z.string(),
  provider: z.string(),
  kind: z.string(),
  label: z.string(),
  status: z.string(),
  email: z.string().optional(),
  subscription: z.string().optional(),
  keyHint: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
})
export type Account = z.infer<typeof providerAccountSchema>

export const providerGroupsOf = (accounts: readonly Account[]) =>
  PROVIDER_CATALOGUE.map((provider) => ({
    provider,
    accounts: accounts.filter((account) => account.provider === provider.id),
  }))

const KNOWN_PLANS: Record<string, string> = {
  max: 'Max',
  pro: 'Pro',
  plus: 'Plus',
  team: 'Team',
  enterprise: 'Enterprise',
}

export function planNameOf(subscription: string | null | undefined): string | null {
  const raw = (subscription ?? '').trim()
  if (raw === '') return null
  const normalized = raw.toLowerCase()
  if (normalized.includes('business')) return 'Business'
  const known = KNOWN_PLANS[normalized]
  if (known !== undefined) return known
  return raw
    .split('_')
    .map((word) => (word === '' ? '' : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`))
    .join(' ')
}

export const providerKeyMaskOf = ({
  account,
  provider,
}: {
  account: Account
  provider: ProviderInfo
}): string | null => {
  const hint = account.keyHint
  if (!hint) return null
  return provider.keyPrefix ? `${provider.keyPrefix}…${hint}` : `••••${hint}`
}

export const providerAccountDetailOf = ({
  account,
  provider,
}: {
  account: Account
  provider: ProviderInfo
}): string => {
  if (account.kind === EAccountKind.Oauth) {
    const product = provider.plan?.product ?? provider.name
    const plan = planNameOf(account.subscription)
    return `${plan === null ? product : `${product} ${plan}`} plan · Signed in ${shortDate(account.createdAt)}`
  }
  const masked = providerKeyMaskOf({ account, provider })
  return `API key${masked ? ` · ${masked}` : ''} · Added ${shortDate(account.createdAt)}`
}

export enum EKeyDialogMode {
  Add = 'add',
  Replace = 'replace',
  Rename = 'rename',
}
export type KeyDialogResult = { name: string; key: string; use: boolean }
export const providerKeyReady = ({
  mode,
  name,
  key,
}: {
  mode: EKeyDialogMode
  name: string
  key: string
}): boolean => (mode === EKeyDialogMode.Rename ? name.trim().length > 0 : key.trim().length > 0)
export const providerKeyResult = ({
  name,
  key,
  use,
  offerUse,
}: KeyDialogResult & { offerUse: boolean }): KeyDialogResult => ({
  name: name.trim() || DEFAULT_API_KEY_LABEL,
  key: key.trim(),
  use: offerUse && use,
})
