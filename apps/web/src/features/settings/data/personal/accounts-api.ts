import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-wire'
import { z } from 'zod'

import { api, cloudCall } from '@/lib/api-client'

import { EProviderId, type ApiKeyEntry } from '../../fixtures/settings-agent'
import { shortDate } from './relative-time'

export enum EAccountKind {
  Oauth = 'oauth',
  ApiKey = 'api-key',
}

const AUTH_PROVIDER_OF: Record<EProviderId, EAuthProvider> = {
  [EProviderId.Anthropic]: EAuthProvider.Anthropic,
  [EProviderId.OpenAI]: EAuthProvider.OpenAI,
  [EProviderId.OpenRouter]: EAuthProvider.OpenRouter,
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

export function subscriptionFor(args: {
  accounts: Account[]
  provider: EProviderId
}): Account | null {
  return (
    args.accounts.find(
      (account) => account.provider === args.provider && account.kind === EAccountKind.Oauth,
    ) ?? null
  )
}

export function apiKeyFor(args: {
  accounts: Account[]
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
