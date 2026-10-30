import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  type AccountId,
  type AccountStorePort,
  type StoredAccount,
} from '@dltech/atlas-core'
import { ENV_NAME_PATTERN, isHarnessLocalOnlyName } from '@dltech/atlas-wire'

import { FileMcpSource } from '../mcp/config/sources'
import type { FileSecretsStore } from '../secrets/file-secrets-store'
import type { CloudClient } from './cloud-client'
import { accountDraftOf, sameAccountSecret } from './sync-accounts'
import { RemoteAccountStore } from './remote-account-store'

export type { CloudSyncCounts } from './sync-accounts'

const sameCloudAccount = (held: StoredAccount, local: StoredAccount): boolean => {
  if (held.provider !== local.provider || held.secret.kind !== local.secret.kind) return false
  if (sameAccountSecret(held.secret, local.secret)) return true
  return local.secret.kind === EAuthKind.Oauth && held.label === local.label
}

export async function uploadLocalAccounts(args: {
  client: CloudClient
  local: AccountStorePort
}): Promise<number> {
  const remote = new RemoteAccountStore({ client: args.client })

  const heldRemote: StoredAccount[] = []
  for (const account of await args.client.listAccounts()) {
    const stored = await args.client.readAccount({ accountId: account.id })
    if (stored !== undefined) heldRemote.push(stored)
  }

  const remoteIds = new Map<AccountId, AccountId>()
  const added = new Set<AccountId>()
  for (const account of await args.local.list()) {
    if (account.origin === EAccountOrigin.Environment) continue
    const stored = await args.local.read(account.id)
    if (stored === undefined) continue

    const duplicate = heldRemote.find((held) => sameCloudAccount(held, stored))
    if (duplicate !== undefined) {
      remoteIds.set(account.id, duplicate.id)
      continue
    }

    const created = await remote.add(accountDraftOf(stored))
    remoteIds.set(account.id, created.id)
    added.add(created.id)
  }

  for (const provider of Object.values(EAuthProvider)) {
    const active = await args.local.activeFor(provider)
    if (active === undefined) continue

    const remoteId = remoteIds.get(active)
    if (remoteId === undefined) continue
    if (!added.has(remoteId) && (await remote.activeFor(provider)) !== undefined) continue

    await remote.setActive({ provider, accountId: remoteId })
  }

  return remoteIds.size
}

export async function uploadLocalSecrets(args: {
  client: CloudClient
  localSecrets: FileSecretsStore | undefined
}): Promise<number> {
  if (args.localSecrets === undefined) return 0

  const held = new Set((await args.client.listSecrets()).map((secret) => secret.name))
  let uploaded = 0
  for (const name of args.localSecrets.names()) {
    if (isHarnessLocalOnlyName(name) || ENV_NAME_PATTERN.test(name) || held.has(name)) continue
    const value = args.localSecrets.read(name)
    if (value === undefined) continue
    await args.client.putSecret({ name, value })
    uploaded += 1
  }
  return uploaded
}

export async function uploadLocalMcp(args: { client: CloudClient }): Promise<number> {
  const read = await FileMcpSource.user().load()

  let uploaded = 0
  for (const spec of read.specs) {
    await args.client.putMcpServer({
      name: spec.name,
      ...(spec.transport === undefined ? {} : { transport: spec.transport }),
      ...(spec.disabled === undefined ? {} : { disabled: spec.disabled }),
    })
    uploaded += 1
  }
  return uploaded
}
