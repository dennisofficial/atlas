import { z } from 'zod'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

import { EProviderId, type ApiKeyEntry } from '../../fixtures/settings-agent'
import { shortDate } from './relative-time'

export enum EAccountKind {
  Oauth = 'oauth',
  ApiKey = 'api-key',
}

const ACCOUNT_ORIGIN_LOGIN = 'login'

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

export function fetchAccounts(): Promise<Account[]> {
  return cloudJson({
    method: EHttpMethod.Get,
    path: '/v1/accounts',
    schema: z.array(accountSchema),
  })
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
  await cloudJson({
    method: EHttpMethod.Post,
    path: '/v1/accounts',
    body: {
      provider: args.provider,
      label: API_KEY_LABEL,
      origin: ACCOUNT_ORIGIN_LOGIN,
      secret: { kind: EAccountKind.ApiKey, apiKey: args.apiKey },
    },
    schema: accountSchema,
  })
}

export function replaceApiKey(args: { accountId: string; apiKey: string }): Promise<void> {
  return cloudSend({
    method: EHttpMethod.Put,
    path: `/v1/accounts/${encodeURIComponent(args.accountId)}/secret`,
    body: { secret: { kind: EAccountKind.ApiKey, apiKey: args.apiKey } },
  })
}

export function removeAccount(accountId: string): Promise<void> {
  return cloudSend({
    method: EHttpMethod.Delete,
    path: `/v1/accounts/${encodeURIComponent(accountId)}`,
  })
}
