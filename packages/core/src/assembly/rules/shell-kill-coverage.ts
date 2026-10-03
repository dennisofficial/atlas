import type { Event, EventOfType } from '../../events/envelope'
import type { EventId } from '../../events/ids'

const SHELL_KILL = 'shell_kill'

type KillResult = EventOfType<'tool-result'>

const isKillResult = (event: Event): event is KillResult =>
  event.type === 'tool-result' && event.name === SHELL_KILL && event.error === undefined

function killKeyOf(event: KillResult): string | undefined {
  if (typeof event.output !== 'object' || event.output === null) return undefined
  const output = event.output as { shellId?: unknown; command?: unknown }
  if (typeof output.shellId !== 'string') return undefined
  return `${output.shellId} ${typeof output.command === 'string' ? output.command : ''}`
}

const endingKeyOf = (event: EventOfType<'background-shell-ended'>): string =>
  `${event.shellId} ${event.command}`

export function endingsToldByKill(events: readonly Event[]): ReadonlySet<EventId> {
  const covered = new Set<EventId>()
  let unmatchedEndings = new Map<string, EventId[]>()
  let unmatchedKills = new Map<string, number>()

  for (const event of events) {
    if (event.type === 'assistant-said') {
      unmatchedEndings = new Map()
      unmatchedKills = new Map()
      continue
    }

    if (event.type === 'background-shell-ended') {
      const key = endingKeyOf(event)
      const credit = unmatchedKills.get(key) ?? 0
      if (credit > 0) {
        unmatchedKills.set(key, credit - 1)
        covered.add(event.id)
        continue
      }
      unmatchedEndings.set(key, [...(unmatchedEndings.get(key) ?? []), event.id])
      continue
    }

    if (!isKillResult(event)) continue

    const key = killKeyOf(event)
    if (key === undefined) continue

    const [oldest, ...rest] = unmatchedEndings.get(key) ?? []
    if (oldest === undefined) {
      unmatchedKills.set(key, (unmatchedKills.get(key) ?? 0) + 1)
      continue
    }
    covered.add(oldest)
    unmatchedEndings.set(key, rest)
  }

  return covered
}
