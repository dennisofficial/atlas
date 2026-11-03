import {
  accountSchema,
  chooseAccount,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Account,
} from '@dltech/atlas-harness/titling'
import { SHIPPED_DEFAULT_REF } from '@dltech/atlas-harness/models'
import type { AccountLease, StoredAccountDto } from '@dltech/atlas-wire'

export type ModelCredential =
  | { kind: 'oauth'; connectionId: string }
  | { kind: 'api-key'; apiKey: string }

export type ModelConfigBlock =
  | { configured: true; modelId: string; accountId: string; credential: ModelCredential }
  | { configured: false; gap: string }

export const accountsOf = (lease: AccountLease): Account[] =>
  lease.accounts.flatMap((stored) => {
    const parsed = accountSchema.safeParse(stored)
    return parsed.success ? [parsed.data] : []
  })

const anthropicAccountOf = (
  lease: AccountLease,
): { account: Account; stored: StoredAccountDto } | { gap: string } => {
  const activeId = lease.active.find(
    (pointer) => pointer.provider === EAuthProvider.Anthropic,
  )?.accountId
  const choice = chooseAccount({
    accounts: accountsOf(lease),
    provider: EAuthProvider.Anthropic,
    ...(activeId === undefined ? {} : { preferred: toAccountId(activeId) }),
  })
  if (choice.type !== EAccountChoice.Chosen) return { gap: `no anthropic account` }
  const stored = lease.accounts.find((candidate) => candidate.id === choice.account.id)
  if (stored === undefined || stored.secret === undefined) {
    return { gap: `account ${choice.account.id} has no secret` }
  }
  return { account: choice.account, stored }
}

const credentialOf = (secret: StoredAccountDto['secret']): ModelCredential | { gap: string } => {
  if (secret === undefined) return { gap: 'account has no secret' }
  if (secret.kind === EAuthKind.ApiKey) return { kind: 'api-key', apiKey: secret.apiKey }
  const connectionId = secret.authority?.connectionId
  if (connectionId === undefined) {
    return { gap: 'oauth account has no cloud connection' }
  }
  return { kind: 'oauth', connectionId }
}

export const modelIdOf = (settings: Record<string, string>): string => {
  const stored = settings['model.id']
  if (stored !== undefined && stored.startsWith('anthropic/')) {
    return stored.slice('anthropic/'.length)
  }
  return SHIPPED_DEFAULT_REF.modelId
}

export const modelConfigOf = (args: {
  lease: AccountLease
  settings: Record<string, string>
}): ModelConfigBlock => {
  const chosen = anthropicAccountOf(args.lease)
  if ('gap' in chosen) return { configured: false, gap: chosen.gap }
  const credential = credentialOf(chosen.stored.secret)
  if ('gap' in credential) return { configured: false, gap: credential.gap }
  return {
    configured: true,
    modelId: modelIdOf(args.settings),
    accountId: chosen.account.id,
    credential,
  }
}
