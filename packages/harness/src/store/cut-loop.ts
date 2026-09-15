import {
  rewindPlan,
  rewindTarget,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from './thread-store'

export type ApplyLoopCut = (args: {
  threadId: ThreadId
  toSeq: number
  throughSeq: number
  notice: EventDraft
}) => Promise<boolean>

/**
 * The loop decides a cut; this is the only part that touches the store. Two races are checked
 * rather than assumed away: something appended since detection (the tail moved, so the plan is
 * stale), and the cut range turning out to hold a creation after all (rewindPlan is the same
 * computation operator rewind confirms against, and an automatic cut never gets that
 * confirmation — it declines instead).
 */
export function createLoopCut({
  threads,
  log,
  ids,
}: {
  threads: ThreadStorePort
  log: EventLogPort
  ids: IdPort
}): ApplyLoopCut {
  return async ({ threadId, toSeq, throughSeq, notice }) => {
    const owned = await log.readOwn({ threadId })
    if (owned.at(-1)?.seq !== throughSeq) return false

    const firstOwned = owned[0]
    const floorSeq = firstOwned === undefined ? await log.head({ threadId }) : firstOwned.seq - 1
    const target = rewindTarget({ events: owned, toSeq, floorSeq })
    if (!target.allowed) return false

    const plan = rewindPlan({ events: owned, toSeq })
    if (plan.cuts.length > 0) return false

    await threads.rewind({ threadId, toSeq, cutAgents: [] })

    const runId = ids.nextRunId()
    await log.append({ threadId, runId, drafts: [notice] })
    for (const surviving of plan.reappend) {
      await log.append({ threadId, runId: surviving.runId, drafts: [surviving.draft] })
    }

    return true
  }
}
