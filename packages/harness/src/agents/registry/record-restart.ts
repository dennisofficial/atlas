import {
  EAgentRestart,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ChildState } from './child-state'

/**
 * A restart lives only in memory until the child next ends: nothing in the parent's log says the
 * child ever left its last recorded ending, so a process that dies mid-restart rebuilds a roster
 * showing the stale pre-restart state. Recording the restart makes the rebuilt roster read as an
 * un-ended child instead, which the lost-children settling on open then completes honestly.
 */
export async function recordRestart({
  log,
  ids,
  child,
  via,
}: {
  log: EventLogPort
  ids: IdPort
  child: ChildState
  via: EAgentRestart
}): Promise<void> {
  await log.append({
    threadId: child.spawnedBy,
    runId: ids.nextRunId(),
    drafts: [
      {
        type: 'agent-restarted',
        agentId: child.agentId,
        agentType: child.agentType,
        intent: child.intent,
        via,
      },
    ],
  })
}
