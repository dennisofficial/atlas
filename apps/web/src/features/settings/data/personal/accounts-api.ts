import { EAccountOrigin, EAuthKind } from '@dltech/atlas-wire/web'
import {
  AUTH_PROVIDER_OF,
  DEFAULT_API_KEY_LABEL,
  providerAccountSchema,
  type Account,
} from '@dltech/atlas-client/settings'
import { z } from 'zod'

import { api, cloudCall } from '@/lib/api-client'

import { EProviderId } from '../../fixtures/settings-agent'

export {
  EAccountKind,
  DEFAULT_API_KEY_LABEL,
  AUTH_PROVIDER_OF,
  type Account,
} from '@dltech/atlas-client/settings'

export async function fetchAccounts(): Promise<Account[]> {
  return z.array(providerAccountSchema).parse(await cloudCall(api.accounts.list.query()))
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
