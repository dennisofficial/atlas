import type { Event } from '../events/envelope'
import { reachesModel } from '../events/notice-stage'
import { EKilledBy } from '../shells/status'

/** Session-end stops that a later ending of the same agent replaces before the model's next step. */
export function supersededEndingIds(events: readonly Event[]): ReadonlySet<string> {
  const superseded = new Set<string>()
  const unseenStops = new Map<string, string>()

  for (const event of events) {
    if (event.type === 'assistant-said' || event.type === 'tool-called') {
      unseenStops.clear()
      continue
    }
    if (event.type !== 'agent-ended' || !reachesModel(event)) continue

    const earlier = unseenStops.get(event.agentId)
    if (earlier !== undefined) superseded.add(earlier)
    if (event.killedBy === EKilledBy.SessionEnd) unseenStops.set(event.agentId, event.id)
    else unseenStops.delete(event.agentId)
  }

  return superseded
}
