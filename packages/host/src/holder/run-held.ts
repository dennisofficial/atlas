import { EHeldOutcome, type HeldOutcome, type Lease, type ThreadId } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HeldSession } from './held-session'

export const runHeld = async (args: {
  session: HeldSession
  lease: Lease
  threadId: ThreadId
  claimMs?: number | undefined
  log?: LogPort | undefined
}): Promise<HeldOutcome> => {
  const { session, lease, threadId, claimMs } = args
  try {
    return await session.run({
      lease,
      threadId,
      ...(claimMs === undefined ? {} : { claimMs }),
    })
  } catch (error) {
    args.log?.error({
      source: 'holder.session',
      message: `the run of ${lease.sessionId} rejected past its guard`,
      ...logFieldsOf({ error }),
    })
    return { kind: EHeldOutcome.Faulted, needsHolder: true }
  }
}
