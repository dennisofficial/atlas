import { randomUUID } from 'node:crypto'
import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { db, violatedConstraint, type Row } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { wakeClaimActive } from '../../platform/sandboxes/sandbox-lifecycle'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { mintSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { SANDBOX_REGION } from '../../platform/sandboxes/vercel-sandbox.client'

const THREAD_UNIQUE = 'CloudSandbox_threadId_key'

export type RowClaim = { token: string; wakeClaim: Date; name: string }

export function standingStateOf(row: Row<'CloudSandbox'>): ESandboxProvisionState | undefined {
  if (row.state === ESandboxState.Running && row.serveUrl) return ESandboxProvisionState.Running
  const failedAfterClaim =
    row.wakeFailedAt !== null &&
    row.wakeClaim !== null &&
    row.wakeFailedAt.getTime() > row.wakeClaim.getTime()
  if (wakeClaimActive(row) && !failedAfterClaim) return ESandboxProvisionState.Booting
  return undefined
}

export async function claimRow(args: {
  thread: Row<'Thread'>
  existing: Row<'CloudSandbox'> | null
  cipher: SecretCipherService
}): Promise<RowClaim | null> {
  const { token, tokenHash } = mintSessionToken()
  const sealedToken = args.cipher.encrypt(token)
  const wakeClaim = new Date()
  const name = args.existing?.name ?? sandboxNameFor({ threadId: args.thread.id })
  if (args.existing === null) {
    try {
      await db.orm.public.CloudSandbox.create({
        id: `sbx_${randomUUID()}`,
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
    return { token, wakeClaim, name }
  }
  const claimed = await db.orm.public.CloudSandbox.where({
    threadId: args.thread.id,
    wakeClaim: args.existing.wakeClaim,
  }).updateAndCount({
    wakeClaim,
    tokenHash,
    sealedToken,
    state: ESandboxState.Resuming,
    updatedAt: wakeClaim,
  })
  return claimed === 0 ? null : { token, wakeClaim, name }
}

export async function markRunning(args: { threadId: string; serveUrl: string }): Promise<void> {
  const at = new Date()
  await db.orm.public.CloudSandbox.where({ threadId: args.threadId }).update({
    state: ESandboxState.Running,
    serveUrl: args.serveUrl,
    wakeFailedAt: null,
    lastActivityAt: at,
    updatedAt: at,
  })
}

export async function markFailed(args: { threadId: string; wakeClaim: Date }): Promise<void> {
  const at = new Date()
  await db.orm.public.CloudSandbox.where({
    threadId: args.threadId,
    wakeClaim: args.wakeClaim,
  }).updateAndCount({ wakeClaim: null, wakeFailedAt: at, updatedAt: at })
}
