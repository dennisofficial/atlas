import { shellKey, type V2Event } from '@dltech/atlas-core'

import { NOTHING_IN_BACKGROUND, type BackgroundWork } from './background-wait'

/**
 * The reading a live roster gives a v1 thread, taken from the log instead: a v2 client holds the
 * session's journal and no roster, and every shell and child run leaves a start and an ending in
 * it. Counted over the whole tree, so a child's own background shell is the parent's wait too.
 */
export function journalActivityOf(events: readonly V2Event[]): BackgroundWork {
  const shells = new Set<string>()
  const agents = new Set<string>()

  for (const event of events) {
    switch (event.type) {
      case 'background-shell-started':
        shells.add(shellKey(event))
        break
      case 'background-shell-ended':
        shells.delete(shellKey(event))
        break
      case 'agent-spawned':
      case 'agent-restarted':
        agents.add(event.agentId)
        break
      case 'agent-ended':
        agents.delete(event.agentId)
        break
    }
  }

  if (shells.size === 0 && agents.size === 0) return NOTHING_IN_BACKGROUND
  return { subagents: agents.size, shells: shells.size }
}
