import { reportWakesParent, type Event, type EventId, type EventOfType } from '@dltech/atlas-core'

type QuietEnding = EventOfType<'agent-ended'>

type QuietRun = { anchor: EventId; latest: QuietEnding; relayed: boolean }

export function quietEndingRuns(events: readonly Event[]): ReadonlyMap<EventId, QuietEnding> {
  const runs: QuietRun[] = []
  const open = new Map<string, QuietRun>()

  for (const event of events) {
    if (event.type === 'agent-ended' && event.relayed === false) {
      const run = open.get(event.agentId)
      if (run === undefined) {
        const started: QuietRun = { anchor: event.id, latest: event, relayed: false }
        runs.push(started)
        open.set(event.agentId, started)
        continue
      }

      run.latest = event
      continue
    }

    const wakes =
      event.type === 'agent-ended' ||
      (event.type === 'agent-reported' && reportWakesParent(event.kind))
    if (!wakes) continue

    const run = open.get(event.agentId)
    if (run === undefined) continue

    run.relayed = true
    open.delete(event.agentId)
  }

  return new Map(runs.filter((run) => !run.relayed).map((run) => [run.anchor, run.latest]))
}
