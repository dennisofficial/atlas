import type { Event, EventOfType } from '../events/envelope'

type ContextLoaded = EventOfType<'context-loaded'>

const basenameOf = (key: string): string => key.split('/').pop() ?? key

// A relocation (worktree entry, lift, descend) re-loads the same file from a new absolute path,
// and the harness dedupe keeps the original event, so a same-content re-load only reaches the
// log from older sessions or a path the writer could not match. Such a pair is one file: the
// newer reading is where the file lives now, so it supersedes. Same key is the ordinary
// reload-on-change case. Same basename with different content is two real files — a monorepo's
// per-package AGENTS.md — and both stay current.
const supersedes = (later: ContextLoaded, earlier: ContextLoaded): boolean => {
  if (later.slot !== earlier.slot) return false
  if (later.key === earlier.key) return true
  return basenameOf(later.key) === basenameOf(earlier.key) && later.content === earlier.content
}

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

export function supersededContextIds(events: readonly Event[]): ReadonlySet<string> {
  const current = new Set(currentContextEvents(events).map((event) => event.id))

  return new Set(
    events
      .filter((event) => event.type === 'context-loaded' && !current.has(event.id))
      .map((event) => event.id),
  )
}
