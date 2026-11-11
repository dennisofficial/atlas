import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { api, cloudCall } from '@/lib/api-client'

import { EProviderId, type ApiKeyEntry } from '../../fixtures/settings-agent'
import { shortDate } from './relative-time'

export enum EAccountKind {
  Oauth = 'oauth',
  ApiKey = 'api-key',
}

export const AUTH_PROVIDER_OF: Record<EProviderId, EAuthProvider> = {
  [EProviderId.Anthropic]: EAuthProvider.Anthropic,
  [EProviderId.OpenAI]: EAuthProvider.OpenAI,
  [EProviderId.OpenRouter]: EAuthProvider.OpenRouter,
  [EProviderId.Inference]: EAuthProvider.Inference,
  [EProviderId.Gateway]: EAuthProvider.Gateway,
}

const accountSchema = z.object({
  id: z.string(),
  provider: z.string(),
  kind: z.string(),
  label: z.string(),
  status: z.string(),
  email: z.string().optional(),
  subscription: z.string().optional(),
  createdAt: z.string(),
})

export type Account = z.infer<typeof accountSchema>

export async function fetchAccounts(): Promise<Account[]> {
  return z.array(accountSchema).parse(await cloudCall(api.accounts.list.query()))
}

export async function fetchActiveAccountId(provider: EProviderId): Promise<string | null> {
  const active = await cloudCall(
    api.accounts.active.query({ provider: AUTH_PROVIDER_OF[provider] }),
  )
  return active.accountId
}

export async function activateAccount(args: {
  provider: EProviderId
  accountId: string
}): Promise<void> {
  await cloudCall(
    api.accounts.setActive.mutate({
      provider: AUTH_PROVIDER_OF[args.provider],
      accountId: args.accountId,
    }),
  )
}

export function apiKeyFor(args: {
  accounts: readonly Account[]
  provider: EProviderId
}): ApiKeyEntry | null {
  const account = args.accounts.find(
    (candidate) => candidate.provider === args.provider && candidate.kind === EAccountKind.ApiKey,
  )
  if (account === undefined) return null
  return { id: account.id, label: account.label, added: `Added ${shortDate(account.createdAt)}` }
}

export const API_KEY_LABEL = 'Key saved'

export async function createApiKeyAccount(args: {
  provider: EProviderId
  apiKey: string
}): Promise<void> {
  await cloudCall(
    api.accounts.create.mutate({
      provider: AUTH_PROVIDER_OF[args.provider],
      label: API_KEY_LABEL,
      origin: EAccountOrigin.Login,
      secret: { kind: EAuthKind.ApiKey, apiKey: args.apiKey },
    }),
  )
}

export async function replaceApiKey(args: { accountId: string; apiKey: string }): Promise<void> {
  await cloudCall(
    api.accounts.replaceSecret.mutate({
      accountId: args.accountId,
      secret: { kind: EAuthKind.ApiKey, apiKey: args.apiKey },
    }),
  )
}

export async function removeAccount(accountId: string): Promise<void> {
  await cloudCall(api.accounts.remove.mutate({ accountId }))
}
