import {
  EKilledBy,
  eventsOfType,
  rewindShellPlan,
  rewindTarget,
  type ThreadId,
  type ERewindRefusal,
  type EventLogPort,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { ShellRegistryPort } from '../shells/shell-registry'
import type { ThreadStorePort } from './thread-store'

export type RewoundShell = {
  shellId: string
  command: string
  description?: string | undefined
}

export type RewindResult =
  | { ok: true; discarded: number; cutShells: readonly RewoundShell[] }
  | { ok: false; refusal: ERewindRefusal; reason: string }

export async function rewindThread({
  log,
  threads,
  agents,
  shells,
  threadId,
  toSeq,
}: {
  log: EventLogPort
  threads: ThreadStorePort
  agents: AgentRegistryPort
  shells: ShellRegistryPort
  threadId: ThreadId
  toSeq: number
}): Promise<RewindResult> {
  const events = await log.read({ threadId })
  const owned = await log.readOwn({ threadId })
  const firstOwned = owned[0]
  const floorSeq = firstOwned === undefined ? await log.head({ threadId }) : firstOwned.seq - 1

  const target = rewindTarget({ events, toSeq, floorSeq })
  if (!target.allowed) return { ok: false, refusal: target.refusal, reason: target.reason }

  const cutAgents = eventsOfType({ events: owned, type: 'agent-spawned' })
    .filter((spawn) => spawn.seq > toSeq)
    .map((spawn) => spawn.agentId)

  const plan = rewindShellPlan({ events, toSeq })
  const cutShells = shells
    .list({ threadId })
    .filter((shell) => plan.cutShellIds.includes(shell.shellId))

  await threads.rewind({ threadId, toSeq, cutAgents })

  for (const notice of plan.reappend) {
    await log.append({ threadId, runId: notice.runId, drafts: [notice.draft] })
  }

  shells.removeShells({
    threadId,
    shellIds: cutShells.map((shell) => shell.shellId),
    by: EKilledBy.Rewind,
  })
  await agents.removeChildren({ threadId, agentIds: cutAgents })

  return {
    ok: true,
    discarded: owned.filter((event) => event.seq > toSeq).length - plan.reappend.length,
    cutShells: cutShells.map((shell) => ({
      shellId: shell.shellId,
      command: shell.command,
      description: shell.description,
    })),
  }
}
