import {
  accountOf,
  chooseAccount,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  parseRef,
  type Account,
  type AccountId,
  type AccountStorePort,
  type StoredAccount,
  type ThreadId,
} from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../credentials/credential-error'
import { isOauthHandoffCandidate } from '../credentials/oauth-eligibility'
import { sameUrl } from '../credentials/oauth-owned-secret'
import type { CloudSession } from './cloud-session'
import { cloudRequest } from './cloud-transport'
import { SandboxClient } from './sandbox-client'

export type OauthHandoffCallback = (
  session: CloudSession,
  accountIds?: readonly AccountId[],
) => Promise<void>

export type OauthClassification = {
  eligible: readonly AccountId[]
  excluded: readonly Account[]
}

const unavailable = (message: string): CredentialError =>
  new CredentialError({ failure: ECredentialFailure.StoreUnavailable, message })

const readOauth = async (accounts: AccountStorePort): Promise<StoredAccount[]> => {
  const held: StoredAccount[] = []
  for (const account of await accounts.list()) {
    if (account.kind !== EAuthKind.Oauth) continue
    const stored = await accounts.read(account.id)
    if (stored?.secret.kind === EAuthKind.Oauth) held.push(stored)
  }
  return held
}

const cloudUrlFor = (args: { session: CloudSession | null; stored: StoredAccount }): string =>
  args.session?.url ?? (args.stored.secret.kind === EAuthKind.Oauth ? args.stored.secret.authority?.url : undefined) ?? ''

export async function classifyOauthAccounts(args: {
  accounts: AccountStorePort
  session: CloudSession | null
}): Promise<OauthClassification> {
  const eligible: AccountId[] = []
  const excluded: Account[] = []
  for (const stored of await readOauth(args.accounts)) {
    const cloudUrl = cloudUrlFor({ session: args.session, stored })
    if (isOauthHandoffCandidate({ stored, cloudUrl })) eligible.push(stored.id)
    else excluded.push(accountOf(stored))
  }
  return { eligible, excluded }
}

const selectedAccountOf = async (args: {
  accounts: AccountStorePort
  model: string
  excluded: readonly Account[]
}): Promise<AccountId | undefined> => {
  const providerId = parseRef(args.model)?.providerId
  const provider = Object.values(EAuthProvider).find((candidate) => candidate === providerId)
  if (provider === undefined) return undefined

  const choice = chooseAccount({
    accounts: await args.accounts.list(),
    provider,
    preferred: await args.accounts.activeFor(provider),
  })
  if (choice.type !== EAccountChoice.Chosen) return undefined

  const blocked = args.excluded.find((account) => account.id === choice.account.id)
  if (blocked === undefined) return choice.account.id
  throw unavailable(
    `The ${blocked.label} login cannot be lifted because it has no Atlas Cloud authorization. Sign in again with /auth to authorize it, or select an API-key account.`,
  )
}

export async function prepareSandboxOauth(args: {
  accounts: AccountStorePort
  session: CloudSession | null
  handoffOauth: OauthHandoffCallback | undefined
  registration: { threadId: ThreadId; token: string; serveUrl: string }
  clientVersion: string
  fetchFn: typeof fetch
  model?: string | undefined
}): Promise<void> {
  const { eligible, excluded } = await classifyOauthAccounts(args)
  const selectedId =
    args.model === undefined
      ? undefined
      : await selectedAccountOf({ accounts: args.accounts, model: args.model, excluded })
  if (eligible.length === 0) return

  const session = args.session
  if (session === null && args.model !== undefined && (selectedId === undefined || !eligible.includes(selectedId))) {
    return
  }
  if (session === null || args.handoffOauth === undefined) {
    throw unavailable('Sign in to Atlas Cloud before lifting OAuth accounts, or select an API-key account.')
  }
  await args.handoffOauth(session, eligible)

  const connectionIds = new Set<string>()
  for (const accountId of eligible) {
    const stored = await args.accounts.read(accountId)
    if (stored?.secret.kind !== EAuthKind.Oauth) continue
    const { authority, tokens } = stored.secret
    if (authority === undefined || tokens.refreshToken.length > 0) {
      throw unavailable(`The OAuth handoff for ${stored.label} has not completed. Retry Atlas Cloud sign-in before lifting.`)
    }
    if (!sameUrl(authority.url, session.url)) {
      throw unavailable(`The OAuth account ${stored.label} belongs to a different Atlas Cloud API. Sign in to its authority before lifting.`)
    }
    connectionIds.add(authority.connectionId)
  }

  const client = new SandboxClient({
    url: session.url,
    token: session.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  })
  await client.registerSandbox(args.registration)
  for (const connectionId of connectionIds) {
    await cloudRequest({
      url: session.url.replace(/\/+$/, ''),
      token: session.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn,
      method: 'PUT',
      path: `/v1/oauth-connections/${encodeURIComponent(connectionId)}/sandboxes/${encodeURIComponent(args.registration.threadId)}`,
    })
  }
}
