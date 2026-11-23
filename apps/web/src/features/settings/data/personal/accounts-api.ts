import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { api, cloudCall } from '@/lib/api-client'

import { EProviderId } from '../../fixtures/settings-agent'

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

const accountSchema = z.object({
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

export async function createApiKeyAccount(args: {
  provider: EProviderId
  apiKey: string
  label?: string
  makeActive?: boolean
}): Promise<void> {
  await cloudCall(
    api.accounts.create.mutate({
      provider: AUTH_PROVIDER_OF[args.provider],
      label: args.label ?? DEFAULT_API_KEY_LABEL,
      origin: EAccountOrigin.Login,
      secret: { kind: EAuthKind.ApiKey, apiKey: args.apiKey },
      makeActive: args.makeActive,
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

export async function renameAccount(args: { accountId: string; label: string }): Promise<void> {
  await cloudCall(api.accounts.rename.mutate(args))
}

export async function removeAccount(accountId: string): Promise<void> {
  await cloudCall(api.accounts.remove.mutate({ accountId }))
}
