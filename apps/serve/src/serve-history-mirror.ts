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
  threadId: ThreadId
  flusher: Pick<EventFlusher, 'flush' | 'rebase'>
}): void {
  const { app, threadId, flusher } = args

  const mirrored = async <T>(edit: () => Promise<T>): Promise<T> => {
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
    app.rewind.truncate = (given) => mirrored(() => truncate(given))
  }
  const compaction = app.compaction
  if (compaction !== undefined) {
    const summarise = compaction.summarise.bind(compaction)
    const compact = compaction.compact.bind(compaction)
    compaction.summarise = (given) => mirrored(() => summarise(given))
    compaction.compact = (given) => mirrored(() => compact(given))
  }
}
