import type { KeyEvent } from '@opentui/core'

import {
  accountSchema,
  EAuthProvider,
  providerSpec,
  reachableProviders,
  toAccountId,
  type Account,
  type AccountId,
} from '@dltech/atlas-core'

import { providerRows, type ProviderRow } from '../ui/accounts-model'
import type {
  AccountCreateInput,
  AccountRow,
  ProviderSignInBeginInput,
  SessionApi,
  SetActiveAccountInput,
} from './session-api'

export const API_KEY_LABEL = 'Key saved'

export const MIN_POLL_MS = 1_000

export const EXPIRED = 'that code expired — start again from actions.'

export const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

export const isPrintable = (key: KeyEvent): boolean => {
  const sequence = key.sequence ?? ''
  return sequence.length > 0 && !key.ctrl && !key.meta && !/[\u0000-\u001f]/.test(sequence)
}

export const signInElsewhere = (provider: EAuthProvider): string =>
  `sign in to ${providerSpec(provider).label} from the web app, or paste an api key`

export const accountProvider = (provider: EAuthProvider): AccountCreateInput['provider'] =>
  provider as string as AccountCreateInput['provider']

export const signInProvider = (provider: EAuthProvider): ProviderSignInBeginInput['provider'] =>
  provider as string as ProviderSignInBeginInput['provider']

export const activeProvider = (provider: EAuthProvider): SetActiveAccountInput['provider'] =>
  provider as string as SetActiveAccountInput['provider']

export const apiKeyBody = (args: {
  provider: EAuthProvider
  apiKey: string
}): AccountCreateInput => ({
  provider: accountProvider(args.provider),
  label: API_KEY_LABEL,
  origin: 'login' as AccountCreateInput['origin'],
  secret: { kind: 'api-key' as AccountCreateInput['secret']['kind'], apiKey: args.apiKey },
})

export const accountOf = (row: AccountRow): Account =>
  accountSchema.parse({
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    origin: row.origin,
    label: row.label,
    status: row.status,
    ...(row.email === undefined ? {} : { email: row.email }),
    ...(row.subscription === undefined ? {} : { subscription: row.subscription }),
    ...(row.importedFrom === undefined ? {} : { importedFrom: row.importedFrom }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

export const providerRowsOf = async (args: {
  api: SessionApi | null
}): Promise<readonly ProviderRow[]> => {
  if (args.api === null) return []

  const stored = (await args.api.accounts()).map(accountOf)
  const active: Partial<Record<EAuthProvider, AccountId | undefined>> = {}

  for (const spec of reachableProviders()) {
    const answer = await args.api.activeAccount({ provider: spec.provider as string })
    active[spec.provider] = answer.accountId === null ? undefined : toAccountId(answer.accountId)
  }

  return providerRows({ accounts: stored, active })
}
