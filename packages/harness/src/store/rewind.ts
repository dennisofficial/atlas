import {
  rewindPlan,
  rewindTarget,
  type ERewindRefusal,
  type EventLogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { RewindMachineryPort } from './rewind-machinery'
import type { ThreadStorePort } from './thread-store'

export type RewindKill =
  | {
      kind: 'agent'
      agentId: ThreadId
      agentType: string
      intent: string
      running: boolean
    }
  | {
      kind: 'shell'
      shellId: string
      command: string | undefined
      description: string | undefined
      running: boolean
    }
  | {
      kind: 'service'
      serviceId: string
      command: string | undefined
      description: string | undefined
      running: boolean
    }

export type RewindResult =
  | { ok: true; discarded: number; kills: readonly RewindKill[] }
  | { ok: false; refusal: ERewindRefusal; reason: string }
  | {
      ok: false
      needsConfirmation: true
      toSeq: number
      reachable: boolean
      kills: readonly RewindKill[]
    }

/**
 * A cut is anything the rewind would destroy — a spawned child, a background shell, a service —
 * so it is confirmed rather than refused: the operator picked the point, and the confirmation
 * names what dies. `confirmed` is that answer; without it a non-empty plan comes back as
 * `needsConfirmation` and nothing is written. The machinery owns the kill itself, so the same
 * confirmation covers creations on the machine the thread actually runs on.
 */
export async function rewindThread({
  log,
  threads,
  machinery,
  threadId,
  toSeq,
  confirmed = false,
}: {
  log: EventLogPort
  threads: ThreadStorePort
  machinery: RewindMachineryPort
  threadId: ThreadId
  toSeq: number
  confirmed?: boolean
}): Promise<RewindResult> {
  const events = await log.read({ threadId })
  const owned = await log.readOwn({ threadId })
  const firstOwned = owned[0]
  const floorSeq = firstOwned === undefined ? await log.head({ threadId }) : firstOwned.seq - 1

  const target = rewindTarget({ events, toSeq, floorSeq })
  if (!target.allowed) return { ok: false, refusal: target.refusal, reason: target.reason }

  const plan = rewindPlan({ events, toSeq })
  const read = await machinery.snapshot({ cuts: plan.cuts, threadId })

  if (read.kills.length > 0 && !confirmed) {
    return { ok: false, needsConfirmation: true, toSeq, reachable: read.reachable, kills: read.kills }
  }

  const cutAgents = plan.cuts.flatMap((cut) => (cut.kind === 'agent' ? [cut.agentId] : []))

  const durable = machinery.ownsDurableLog === true
  await machinery.destroy({ cuts: plan.cuts, threadId, toSeq })

  // The machine that owns the durable log truncated it as part of destroy; re-appending the
  // surviving notices would land them on a log this process does not own.
  if (durable) {
    return {
      ok: true,
      discarded: owned.filter((event) => event.seq > toSeq).length - plan.reappend.length,
      kills: read.kills,
    }
  }

  await threads.rewind({ threadId, toSeq, cutAgents })

  for (const notice of plan.reappend) {
    await log.append({ threadId, runId: notice.runId, drafts: [notice.draft] })
  }

  return {
    ok: true,
    discarded: owned.filter((event) => event.seq > toSeq).length - plan.reappend.length,
    kills: read.kills,
  }
}
