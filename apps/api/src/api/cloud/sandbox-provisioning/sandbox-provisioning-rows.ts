import { randomUUID } from 'node:crypto'
import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { db, violatedConstraint, type Row, type Tx } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { parkedOf, wakeableOf, wakeClaimActive } from '../../platform/sandboxes/sandbox-lifecycle'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { mintSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { SANDBOX_REGION } from '../../platform/sandboxes/vercel-sandbox.client'

const THREAD_UNIQUE = 'CloudSandbox_threadId_key'

export const NOT_RUNNING_MESSAGE = "The sandbox isn't running. Start it first."
export const SANDBOX_BUSY_MESSAGE = 'The sandbox is busy. Try again in a moment.'

export type RowWriter = Pick<Tx, 'orm'>

export type RowClaim = { token: string; wakeClaim: Date; name: string; sandboxId: string }

export const failedAfterClaim = (row: Row<'CloudSandbox'>): boolean =>
  row.wakeFailedAt !== null &&
  (row.wakeClaim === null || row.wakeFailedAt.getTime() >= row.wakeClaim.getTime())

export const relaunchableOf = (row: Row<'CloudSandbox'> | null): boolean =>
  row === null || wakeableOf(row) || failedAfterClaim(row)

export const appendableOf = (row: Row<'CloudSandbox'> | null): boolean =>
  relaunchableOf(row) || (row !== null && standingStateOf(row) === ESandboxProvisionState.Booting)

export function standingStateOf(row: Row<'CloudSandbox'>): ESandboxProvisionState | undefined {
  if (row.state === ESandboxState.Running && row.serveUrl && !parkedOf(row)) {
    return ESandboxProvisionState.Running
  }
  const failedAfterClaim =
    row.wakeFailedAt !== null &&
    row.wakeClaim !== null &&
    row.wakeFailedAt.getTime() > row.wakeClaim.getTime()
  if (wakeClaimActive(row) && !failedAfterClaim) return ESandboxProvisionState.Booting
  return undefined
}

function tokenOfExisting(args: { existing: Row<'CloudSandbox'>; cipher: SecretCipherService }): {
  token: string
  mintedColumns: { tokenHash: string; sealedToken: string } | Record<string, never>
} {
  if (args.existing.sealedToken !== null) {
    return { token: args.cipher.decrypt(args.existing.sealedToken), mintedColumns: {} }
  }
  const { token, tokenHash } = mintSessionToken()
  return { token, mintedColumns: { tokenHash, sealedToken: args.cipher.encrypt(token) } }
}

export async function claimRow(args: {
  writer?: RowWriter | undefined
  thread: Row<'Thread'>
  existing: Row<'CloudSandbox'> | null
  cipher: SecretCipherService
}): Promise<RowClaim | null> {
  const writer = args.writer ?? db
  const wakeClaim = new Date()
  const name = args.existing?.name ?? sandboxNameFor({ threadId: args.thread.id })
  if (args.existing === null) {
    const { token, tokenHash } = mintSessionToken()
    const sealedToken = args.cipher.encrypt(token)
    const sandboxId = `sbx_${randomUUID()}`
    try {
      await writer.orm.public.CloudSandbox.create({
        id: sandboxId,
        threadId: args.thread.id,
        userId: args.thread.userId,
        sandboxId: '',
        name,
        region: SANDBOX_REGION,
        state: ESandboxState.Resuming,
        lastActivityAt: wakeClaim,
        tokenHash,
        sealedToken,
        contextPending: false,
        wakeClaim,
        createdAt: wakeClaim,
        updatedAt: wakeClaim,
      })
    } catch (failure) {
      if (violatedConstraint(failure) === THREAD_UNIQUE) return null
      throw failure
    }
    return { token, wakeClaim, name, sandboxId }
  }
  const { token, mintedColumns } = tokenOfExisting({ existing: args.existing, cipher: args.cipher })
  const claimed = await writer.orm.public.CloudSandbox.where({
    threadId: args.thread.id,
    wakeClaim: args.existing.wakeClaim,
  }).updateAndCount({
    wakeClaim,
    ...mintedColumns,
    state: ESandboxState.Resuming,
    updatedAt: wakeClaim,
  })
  return claimed === 0 ? null : { token, wakeClaim, name, sandboxId: args.existing.id }
}

export async function markRunning(args: {
  threadId: string
  wakeClaim: Date
  serveUrl: string
}): Promise<boolean> {
  const at = new Date()
  const updated = await db.orm.public.CloudSandbox.where({
    threadId: args.threadId,
    wakeClaim: args.wakeClaim,
  }).updateAndCount({
    state: ESandboxState.Running,
    serveUrl: args.serveUrl,
    wakeFailedAt: null,
    lastActivityAt: at,
    updatedAt: at,
  })
  return updated > 0
}

export async function markFailed(args: {
  writer?: RowWriter | undefined
  threadId: string
  wakeClaim: Date
}): Promise<number> {
  const at = new Date()
  return (args.writer ?? db).orm.public.CloudSandbox.where({
    threadId: args.threadId,
    wakeClaim: args.wakeClaim,
  }).updateAndCount({ wakeClaim: null, wakeFailedAt: at, updatedAt: at })
}

export async function claimHeld(args: { threadId: string; wakeClaim: Date }): Promise<boolean> {
  const row = await db.orm.public.CloudSandbox.where({ threadId: args.threadId })
    .select('wakeClaim')
    .first()
  return row?.wakeClaim?.getTime() === args.wakeClaim.getTime()
}
