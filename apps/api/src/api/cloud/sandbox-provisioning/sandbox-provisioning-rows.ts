import { randomUUID } from 'node:crypto'
import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { db, violatedConstraint, type Row, type Tx } from '@dltech/atlas-db'
import { podSessionOf } from '../../platform/sessions/session-of-thread'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { wakeableOf } from '../../platform/sandboxes/sandbox-lifecycle'
import { failedAfterClaim, standingStateOf } from '../../platform/sandboxes/pod-state'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { mintSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { SANDBOX_REGION } from '../../platform/sandboxes/vercel-sandbox.client'

const THREAD_UNIQUE = 'CloudSandbox_sessionId_key'

export const NOT_RUNNING_MESSAGE = "The sandbox isn't running. Start it first."
export const SANDBOX_BUSY_MESSAGE = 'The sandbox is busy. Try again in a moment.'
export const LOCAL_POD_MESSAGE =
  'This thread runs in a local pod on your machine — open it from the Atlas TUI there.'

export { failedAfterClaim, standingStateOf }

export type RowWriter = Pick<Tx, 'orm'>

export type RowClaim = { token: string; wakeClaim: Date; name: string; sandboxId: string }

export const relaunchableOf = (row: Row<'CloudSandbox'> | null): boolean =>
  row === null || wakeableOf(row) || failedAfterClaim(row)

export const appendableOf = (row: Row<'CloudSandbox'> | null): boolean => {
  if (relaunchableOf(row)) return true
  const standing = row === null ? undefined : standingStateOf(row)
  return standing === ESandboxProvisionState.Booting || standing === ESandboxProvisionState.Running
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
  pendingVcpus?: number | undefined
}): Promise<RowClaim | null> {
  const writer = args.writer ?? db
  const sessionId = await podSessionOf({ reader: writer, threadId: args.thread.id })
  const wakeClaim = new Date()
  const name = args.existing?.name ?? sandboxNameFor({ threadId: args.thread.id })
  if (args.existing === null) {
    const { token, tokenHash } = mintSessionToken()
    const sealedToken = args.cipher.encrypt(token)
    const sandboxId = `sbx_${randomUUID()}`
    try {
      await writer.orm.public.CloudSandbox.create({
        id: sandboxId,
        sessionId,
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
    sessionId,
    wakeClaim: args.existing.wakeClaim,
  }).updateAndCount({
    wakeClaim,
    ...mintedColumns,
    ...(args.pendingVcpus === undefined ? {} : { pendingVcpus: args.pendingVcpus }),
    state: ESandboxState.Resuming,
    updatedAt: wakeClaim,
  })
  return claimed === 0 ? null : { token, wakeClaim, name, sandboxId: args.existing.id }
}

export async function markRunning(args: {
  threadId: string
  wakeClaim: Date
  serveUrl: string
  refreshClaim?: boolean | undefined
}): Promise<boolean> {
  const at = new Date()
  const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
  const updated = await db.orm.public.CloudSandbox.where({
    sessionId,
    wakeClaim: args.wakeClaim,
  }).updateAndCount({
    state: ESandboxState.Running,
    serveUrl: args.serveUrl,
    wakeFailedAt: null,
    pendingVcpus: null,
    ...(args.refreshClaim === true ? { wakeClaim: at } : {}),
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
  const writer = args.writer ?? db
  const sessionId = await podSessionOf({ reader: writer, threadId: args.threadId })
  return writer.orm.public.CloudSandbox.where({
    sessionId,
    wakeClaim: args.wakeClaim,
  }).updateAndCount({ wakeClaim: null, wakeFailedAt: at, pendingVcpus: null, updatedAt: at })
}

export async function claimHeld(args: { threadId: string; wakeClaim: Date }): Promise<boolean> {
  const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
  const row = await db.orm.public.CloudSandbox.where({ sessionId }).select('wakeClaim').first()
  return row?.wakeClaim?.getTime() === args.wakeClaim.getTime()
}
