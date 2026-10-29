import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import type { ServeApp } from './serve-app'
import { podEventOf } from '@dltech/atlas-harness'

import type { EventFlusher } from './serve-event-flush'

type Snapshot = Map<number, string>

const snapshotOf = async (args: {
  events: Pick<EventLogPort, 'readOwn'>
  threadId: ThreadId
}): Promise<Snapshot> => {
  const own = await args.events.readOwn({ threadId: args.threadId })
  return new Map(own.map((event) => [event.seq, JSON.stringify(podEventOf(event))]))
}

export const lowestChangedSeq = (args: {
  before: Snapshot
  after: Snapshot
}): number | undefined => {
  const seqs = new Set([...args.before.keys(), ...args.after.keys()])
  const changed = [...seqs].filter((seq) => args.before.get(seq) !== args.after.get(seq))
  return changed.length === 0 ? undefined : Math.min(...changed)
}

export function mirrorHistoryEdits(args: {
  app: Pick<ServeApp, 'log' | 'rewind' | 'compaction'>
  flusherFor: (threadId: ThreadId) => Pick<EventFlusher, 'flush' | 'rebase'> | undefined
}): void {
  const { app } = args

  const mirrored = async <T>(threadId: ThreadId, edit: () => Promise<T>): Promise<T> => {
    const flusher = args.flusherFor(threadId)
    if (flusher === undefined) return edit()
    const before = await snapshotOf({ events: app.log, threadId })
    const result = await edit()
    const after = await snapshotOf({ events: app.log, threadId })
    const lowest = lowestChangedSeq({ before, after })
    if (lowest === undefined) void flusher.flush()
    else void flusher.rebase({ toSeq: lowest - 1 })
    return result
  }

  const truncate = app.rewind?.truncate
  if (app.rewind !== undefined && truncate !== undefined) {
    app.rewind.truncate = (given) => mirrored(given.threadId, () => truncate(given))
  }
  const compaction = app.compaction
  if (compaction !== undefined) {
    const summarise = compaction.summarise.bind(compaction)
    const compact = compaction.compact.bind(compaction)
    compaction.summarise = (given) => mirrored(given.threadId, () => summarise(given))
    compaction.compact = (given) => mirrored(given.threadId, () => compact(given))
  }
}
