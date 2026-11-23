import type { V2Event } from '@dltech/atlas-core'

type ToolCalled = Extract<V2Event, { type: 'tool-called' }>

const isToolCalled = (event: V2Event): event is ToolCalled => event.type === 'tool-called'

const stepCallsOf = (events: readonly V2Event[]): readonly ToolCalled[] => {
  const anchor = events.findLastIndex((event) => isToolCalled(event) && event.ordinal === 0)
  if (anchor < 0) return []
  const calls: ToolCalled[] = []
  for (const event of events.slice(anchor)) {
    if (!isToolCalled(event)) break
    calls.push(event)
  }
  return calls
}

export const spawnsInStepOf = (events: readonly V2Event[]): number =>
  stepCallsOf(events).filter((event) => event.name === 'agent_spawn').length

export const spawnStepKeyOf = (events: readonly V2Event[]): string | undefined =>
  events.filter(isToolCalled).findLast((event) => event.ordinal === 0)?.callId
