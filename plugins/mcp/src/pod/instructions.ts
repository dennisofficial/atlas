import { EContextSlot, type EventDraft, type V2Event } from '@dltech/atlas-core'

const SLOT = EContextSlot.McpInstructions

const offeredOf = (events: readonly V2Event[]): ReadonlyMap<string, string> => {
  const offered = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'context-loaded' || event.slot !== SLOT) continue
    if (event.content === '') offered.delete(event.key)
    else offered.set(event.key, event.content)
  }
  return offered
}

const draftOf = (args: { key: string; content: string }): EventDraft => ({
  type: 'context-loaded',
  slot: SLOT,
  key: args.key,
  content: args.content,
})

export const mcpInstructionsDraftsOf = (args: {
  events: readonly V2Event[]
  next: ReadonlyMap<string, string>
}): readonly EventDraft[] => {
  const offered = offeredOf(args.events)
  return [
    ...[...args.next]
      .filter(([key, content]) => offered.get(key) !== content)
      .map(([key, content]) => draftOf({ key, content })),
    ...[...offered.keys()]
      .filter((key) => !args.next.has(key))
      .map((key) => draftOf({ key, content: '' })),
  ]
}
