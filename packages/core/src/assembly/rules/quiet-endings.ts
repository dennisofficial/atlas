import { agentLabel } from '../../agents/label'
import type { Event, EventOfType } from '../../events/envelope'

type Ending = EventOfType<'agent-ended'>

export const isQuietEnding = (event: Event): event is Ending =>
  event.type === 'agent-ended' && event.relayed === false

export function supersededQuietEndingIds({
  events,
}: {
  events: readonly Event[]
}): ReadonlySet<string> {
  const superseded = new Set<string>()
  const heardFrom = new Set<string>()

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue

    if (isQuietEnding(event) && heardFrom.has(event.agentId)) superseded.add(event.id)

    if (
      event.type === 'agent-ended' ||
      event.type === 'agent-restarted' ||
      event.type === 'agent-reported'
    ) {
      heardFrom.add(event.agentId)
    }
  }

  return superseded
}

export function quietStatusLine(event: Ending): string {
  const waiting = event.waitingOn === undefined ? '' : `: waiting on ${event.waitingOn}`
  return `Agent ${event.agentId} ${agentLabel(event)} paused and is still working${waiting}. It has not ended and will wake you when it does. Nothing to do.`
}
