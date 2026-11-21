import type { EventDraft } from '../events/body'
import type { Event, EventOfType } from '../events/envelope'

type ContextLoaded = EventOfType<'context-loaded'>

const supersedes = (later: ContextLoaded, earlier: ContextLoaded): boolean =>
  later.slot === earlier.slot && later.key === earlier.key

export function currentContextEvents(events: readonly Event[]): readonly ContextLoaded[] {
  const current: ContextLoaded[] = []
  const later: ContextLoaded[] = []

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'context-loaded') continue
    if (later.some((seen) => supersedes(seen, event))) continue
    later.push(event)
    current.unshift(event)
  }

  return current
}

export function withoutRepeatedContext(args: {
  events: readonly Event[]
  drafts: readonly EventDraft[]
}): readonly EventDraft[] {
  const recorded = new Map<string, Map<string, string>>()
  for (const event of currentContextEvents(args.events)) {
    const byKey = recorded.get(event.slot) ?? new Map<string, string>()
    byKey.set(event.key, event.content)
    recorded.set(event.slot, byKey)
  }

  const kept: EventDraft[] = []
  for (const draft of args.drafts) {
    if (draft.type !== 'context-loaded') {
      kept.push(draft)
      continue
    }
    const byKey = recorded.get(draft.slot) ?? new Map<string, string>()
    recorded.set(draft.slot, byKey)
    if (byKey.get(draft.key) === draft.content) continue
    byKey.set(draft.key, draft.content)
    kept.push(draft)
  }

  return kept
}

export function supersededContextIds(events: readonly Event[]): ReadonlySet<string> {
  const current = new Set(currentContextEvents(events).map((event) => event.id))

  return new Set(
    events
      .filter((event) => event.type === 'context-loaded' && !current.has(event.id))
      .map((event) => event.id),
  )
}
