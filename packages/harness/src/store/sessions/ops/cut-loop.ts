import {
  rewindPlan,
  rewindTarget,
  type ClockPort,
  type IdPort,
} from '@dltech/atlas-core'

import type { ApplyLoopCut } from '../../cut-loop'
import type { JsonlEventLog } from '../event-log'
import type { SessionRegistry } from '../registry'
import { appendDrafts, truncateThreadLog } from './log-edits'

export function createLoopCut({
  log,
  registry,
  clock,
  ids,
}: {
  log: JsonlEventLog
  registry: SessionRegistry
  clock: ClockPort
  ids: IdPort
}): ApplyLoopCut {
  return async ({ threadId, toSeq, throughSeq, notice }) => {
    const sessionDir = await log.sessionDirFor({ threadId })
    const handle = registry.handleFor({ sessionDir })

    return registry.enqueue({
      handle,
      run: async () => {
        const owned = await log.readOwn({ threadId })
        if (owned.at(-1)?.seq !== throughSeq) return false

        const firstOwned = owned[0]
        const floorSeq = firstOwned === undefined ? await log.head({ threadId }) : firstOwned.seq - 1
        const target = rewindTarget({ events: owned, toSeq, floorSeq })
        if (!target.allowed) return false

        const plan = rewindPlan({ events: owned, toSeq })
        if (plan.cuts.length > 0) return false

        await truncateThreadLog({ registry, clock, sessionDir, threadId, toSeq })

        const runId = ids.nextRunId()
        await appendDrafts({ registry, clock, ids, sessionDir, threadId, runId, drafts: [notice] })
        for (const surviving of plan.reappend) {
          await appendDrafts({
            registry,
            clock,
            ids,
            sessionDir,
            threadId,
            runId: surviving.runId,
            drafts: [surviving.draft],
          })
        }

        return true
      },
    })
  }
}
