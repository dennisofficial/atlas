import { toThreadId } from '@dltech/atlas-core'
import type { ECloudSandboxState } from '@dltech/atlas-harness'

import type { CloudSandboxes } from '@dltech/atlas-harness'

/**
 * The one read behind the picker's badges: every cloud row's sandbox asked at once, per opening,
 * never per render. A sandbox whose inspect fails — credentials gone, Vercel down — simply keeps
 * its location-only badge rather than taking the listing down with it.
 */
export async function sandboxStatesFor(args: {
  find: Pick<CloudSandboxes, 'find'>
  threadIds: readonly string[]
}): Promise<Map<string, ECloudSandboxState>> {
  const states = new Map<string, ECloudSandboxState>()

  await Promise.all(
    args.threadIds.map(async (threadId) => {
      try {
        const status = await args.find.find({ threadId: toThreadId(threadId) })
        if (status !== undefined) states.set(threadId, status.state)
      } catch {
        // A badge is decoration; the row stands without it.
      }
    }),
  )

  return states
}
