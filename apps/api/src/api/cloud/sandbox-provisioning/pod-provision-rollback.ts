import {
  isSandboxMissing,
  SANDBOX_QUICK_TIMEOUT_MS,
  type VercelCredentials,
  type VercelSdk,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { podSessionOf } from '../../platform/sessions/session-of-thread'
import { failureText } from '../github/github-sandbox-wake-boot'

const SANDBOX_DELETE_TIMEOUT_MS = 30_000

async function destroyedDuring(args: { threadId: string; wakeClaim: Date }): Promise<boolean> {
  const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
  const row = await db.orm.public.CloudSandbox.first({ sessionId })
  if (row === null) return true
  if (row.wakeClaim !== null) return false
  return row.wakeFailedAt === null || row.wakeFailedAt.getTime() < args.wakeClaim.getTime()
}

export async function rollbackIfDestroyed(args: {
  sdk: VercelSdk
  credentials: VercelCredentials
  threadId: string
  name: string
  wakeClaim: Date
  log: (line: string) => void
}): Promise<void> {
  const { sdk, credentials, threadId, name, wakeClaim, log } = args
  try {
    if (!(await destroyedDuring({ threadId, wakeClaim }))) return
    const sandbox = await sdk
      .get({
        ...credentials,
        name,
        resume: false,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      .catch((failure: unknown) =>
        isSandboxMissing(failure) ? undefined : Promise.reject(failure),
      )
    if (sandbox === undefined) return
    await sandbox.delete({ signal: AbortSignal.timeout(SANDBOX_DELETE_TIMEOUT_MS) })
    log(`deleted sandbox ${name} that provisioning created after thread ${threadId} was destroyed`)
  } catch (failure) {
    log(
      `rolling back sandbox ${name} after the destroy of thread ${threadId} failed — Vercel's idle reaper owns it: ${failureText(failure)}`,
    )
  }
}
