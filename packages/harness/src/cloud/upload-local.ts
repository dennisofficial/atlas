import {
  EAuthProvider,
  type AccountId,
  type AccountStorePort,
  type StoredAccount,
} from '@dltech/atlas-core'

import { FileMcpSource } from '../mcp/config/sources'
import type { FileSecretsStore } from '../secrets/file-secrets-store'
import type { CloudClient } from './cloud-client'
import { accountDraftOf, sameAccountSecret, type CloudSyncCounts } from './sync-accounts'
import { RemoteAccountStore } from './remote-account-store'

export type { CloudSyncCounts } from './sync-accounts'

/**
 * Pushes every local account the cloud does not already hold (matched on provider + label +
 * secret, so a retried upload never duplicates) and points the remote actives at the uploaded
 * ids. Uploads only ever add — nothing remote is deleted or overwritten.
 */
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
  for (const account of await args.local.list()) {
    const stored = await args.local.read(account.id)
    if (stored === undefined) continue

    const duplicate = heldRemote.find(
      (held) =>
        held.provider === stored.provider &&
        held.label === stored.label &&
        sameAccountSecret(held.secret, stored.secret),
    )
    if (duplicate !== undefined) {
      remoteIds.set(account.id, duplicate.id)
      continue
    }

    const added = await remote.add(accountDraftOf(stored))
    remoteIds.set(account.id, added.id)
  }

  for (const provider of Object.values(EAuthProvider)) {
    const active = await args.local.activeFor(provider)
    if (active === undefined) continue

    const remoteId = remoteIds.get(active)
    if (remoteId === undefined) continue

    await remote.setActive({ provider, accountId: remoteId })
  }

  return remoteIds.size
}

export async function uploadLocalSecrets(args: {
  client: CloudClient
  localSecrets: FileSecretsStore | undefined
}): Promise<number> {
  if (args.localSecrets === undefined) return 0

  let uploaded = 0
  for (const name of args.localSecrets.names()) {
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
