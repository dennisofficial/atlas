import type { Event, EventDraft, EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../agents/registry/port'
import type { ServiceRegistryPort } from '../services/service-registry'
import type { ShellRegistryPort } from '../shells/shell-registry'

const identityOf = (draft: EventDraft): string => JSON.stringify(draft)

const alreadyLanded = ({ events, draft }: { events: readonly Event[]; draft: EventDraft }): boolean => {
  const identity = identityOf(draft)
  return events.some((event) => identityOf(event) === identity)
}

/**
 * Notifications that arrived for the predecessor while the rotation prepared are re-pointed at the
 * successor: drained from the notice queues and appended to the successor log, skipping any whose
 * body already landed there (slice 1 journals pre-logged occurrences, so a re-driven reconcile must
 * not append a second copy). The successor's first drain then sees nothing it already owns.
 */
export async function reconcileNotifications(args: {
  log: EventLogPort
  ids: IdPort
  agents: AgentRegistryPort
  shells: ShellRegistryPort
  services: ServiceRegistryPort
  predecessor: ThreadId
  successor: ThreadId
}): Promise<number> {
  const { log, ids, agents, shells, services, predecessor, successor } = args

  const drained: EventDraft[] = [
    ...agents.drainNotifications({ threadId: predecessor }).drafts,
    ...shells.drainNotifications({ threadId: predecessor }),
    ...services.drainNotifications({ threadId: predecessor }),
  ]
  if (drained.length === 0) return 0

  const events = await log.read({ threadId: successor })
  const fresh = drained.filter((draft) => !alreadyLanded({ events, draft }))
  if (fresh.length === 0) return 0

  await log.append({ threadId: successor, runId: ids.nextRunId(), drafts: fresh })
  return fresh.length
}
