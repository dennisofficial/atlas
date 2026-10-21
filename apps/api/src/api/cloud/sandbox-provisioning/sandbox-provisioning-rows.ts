import { randomUUID } from 'node:crypto'
import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { db } from '../../../db'
import type { CloudSandboxModel, ThreadModel } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { wakeClaimActive } from '../../platform/sandboxes/sandbox-lifecycle'
import { sandboxNameFor } from '../../platform/sandboxes/sandbox-names'
import { mintSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { SANDBOX_REGION } from '../../platform/sandboxes/vercel-sandbox.client'
import { isUniqueViolation } from '../github/unique-violation'

export type RowClaim = { token: string; wakeClaim: string; name: string }

export function standingStateOf(row: CloudSandboxModel): ESandboxProvisionState | undefined {
  if (row.state === ESandboxState.Running && row.serveUrl) return ESandboxProvisionState.Running
  const failedAfterClaim =
    row.wakeFailedAt !== null && row.wakeClaim !== null && row.wakeFailedAt > row.wakeClaim
  if (wakeClaimActive(row) && !failedAfterClaim) return ESandboxProvisionState.Booting
  return undefined
}

export async function claimRow(args: {
  thread: ThreadModel
  existing: CloudSandboxModel | null
  cipher: SecretCipherService
}): Promise<RowClaim | null> {
  const { token, tokenHash } = mintSessionToken()
  const sealedToken = args.cipher.encrypt(token)
  const wakeClaim = new Date().toISOString()
  const name = args.existing?.name ?? sandboxNameFor({ threadId: args.thread.id })
  if (args.existing === null) {
    try {
      await db.cloudSandbox.create({
        data: {
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
        },
      })
    } catch (failure) {
      if (isUniqueViolation(failure, ['threadId'])) return null
      throw failure
    }
    return { token, wakeClaim, name }
  }
  const claimed = await db.cloudSandbox.updateMany({
    where: { threadId: args.thread.id, wakeClaim: args.existing.wakeClaim },
    data: { wakeClaim, tokenHash, sealedToken, state: ESandboxState.Resuming, updatedAt: wakeClaim },
  })
  return claimed.count === 0 ? null : { token, wakeClaim, name }
}

export async function markRunning(args: { threadId: string; serveUrl: string }): Promise<void> {
  const at = new Date().toISOString()
  await db.cloudSandbox.update({
    where: { threadId: args.threadId },
    data: {
      state: ESandboxState.Running,
      serveUrl: args.serveUrl,
      wakeFailedAt: null,
      lastActivityAt: at,
      updatedAt: at,
    },
  })
}

export async function markFailed(args: { threadId: string; wakeClaim: string }): Promise<void> {
  const at = new Date().toISOString()
  await db.cloudSandbox.updateMany({
    where: { threadId: args.threadId, wakeClaim: args.wakeClaim },
    data: { wakeClaim: null, wakeFailedAt: at, updatedAt: at },
  })
}
