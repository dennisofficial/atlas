import {
  authorityOf,
  EAuthKind,
  type AccountId,
  type AccountSecret,
  type AccountStorePort,
  type OauthAuthority,
  type StoredAccount,
} from '@dltech/atlas-core'

import type { OauthAccess } from '../cloud/oauth-connections-client'

export const DEFAULT_REFRESH_LEAD_MS = 5 * 60 * 1000
const LEAD_SHARE_OF_REMAINING_LIFE = 0.1

export const sameUrl = (left: string, right: string): boolean =>
  left.replace(/\/+$/, '') === right.replace(/\/+$/, '')

export const millisOf = (instant: string | undefined): number | null => {
  if (instant === undefined) return null
  const parsed = Date.parse(instant)
  return Number.isNaN(parsed) ? null : parsed
}

const refreshAfterOf = (args: { access: OauthAccess; nowMs: number }): string => {
  if (args.access.refreshAfter !== undefined) return args.access.refreshAfter

  const expiresAtMs = Date.parse(args.access.expiresAt)
  const lead = Math.min(
    DEFAULT_REFRESH_LEAD_MS,
    Math.max(0, expiresAtMs - args.nowMs) * LEAD_SHARE_OF_REMAINING_LIFE,
  )

  return new Date(expiresAtMs - lead).toISOString()
}

export const ownedSecretFrom = (args: {
  secret: AccountSecret
  access: OauthAccess
  authority: OauthAuthority
  nowMs: number
}): AccountSecret => {
  if (args.secret.kind !== EAuthKind.Oauth) return args.secret

  const { scopes, accountId } = args.secret.tokens
  const providerAccountId = args.access.providerAccountId ?? accountId
  const authorizationId = args.access.authorizationId ?? args.authority.authorizationId

  return {
    kind: EAuthKind.Oauth,
    tokens: {
      accessToken: args.access.accessToken,
      refreshToken: '',
      expiresAt: args.access.expiresAt,
      ...(scopes === undefined ? {} : { scopes }),
      ...(providerAccountId === undefined ? {} : { accountId: providerAccountId }),
    },
    authority: {
      url: args.authority.url,
      connectionId: args.authority.connectionId,
      ...(authorizationId === undefined ? {} : { authorizationId }),
      generation: args.access.generation,
      refreshAfter: refreshAfterOf({ access: args.access, nowMs: args.nowMs }),
    },
  }
}

export const isPending = (stored: StoredAccount): boolean =>
  stored.secret.kind === EAuthKind.Oauth &&
  authorityOf(stored.secret) !== undefined &&
  stored.secret.tokens.refreshToken.length > 0

export const underAccountLock = <T>(args: {
  accounts: AccountStorePort
  accountId: AccountId
  alreadyLocked: boolean | undefined
  run: () => Promise<T>
}): Promise<T> =>
  args.alreadyLocked === true
    ? args.run()
    : args.accounts.withAccountLock({ accountId: args.accountId, run: args.run })

export async function persistAccess(args: {
  accounts: AccountStorePort
  accountId: AccountId
  connectionId: string
  authorizationId?: string | undefined
  settlesPending: boolean
  access: OauthAccess
  nowMs: () => number
  alreadyLocked?: boolean | undefined
}): Promise<StoredAccount | undefined> {
  return underAccountLock({
    accounts: args.accounts,
    accountId: args.accountId,
    alreadyLocked: args.alreadyLocked,
    run: async () => {
      const current = await args.accounts.read(args.accountId)
      const authority = current === undefined ? undefined : authorityOf(current.secret)
      if (current === undefined || authority?.connectionId !== args.connectionId) return undefined
      if (args.settlesPending && !isPending(current)) return current
      if (authority.authorizationId !== args.authorizationId) return undefined
      if (!args.settlesPending && isPending(current)) return undefined

      const settled = !args.settlesPending
      if (settled && (authority.generation ?? 0) > args.access.generation) return current

      const secret = ownedSecretFrom({
        secret: current.secret,
        access: args.access,
        authority,
        nowMs: args.nowMs(),
      })
      await args.accounts.replaceSecret({ accountId: args.accountId, secret })

      return { ...current, secret }
    },
  })
}
