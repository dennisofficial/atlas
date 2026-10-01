import {
  stampEvent,
  toEventId,
  type Event,
  type EventLogPort,
  type ThreadId,
} from '@dltech/atlas-core'

const AT = '2026-08-25T00:00:00.000Z'

export type FakeEventLog = EventLogPort & {
  readonly branchesRead: readonly ThreadId[]
  readonly ownReads: readonly ThreadId[]
  peek(args: { threadId: ThreadId }): readonly Event[]
  truncate(args: { threadId: ThreadId; toSeq: number }): void
  load(events: readonly Event[]): void
}

export function fakeEventLog(seeded: readonly Event[] = []): FakeEventLog {
  const byThread = new Map<ThreadId, Event[]>()
  const headByThread = new Map<ThreadId, number>()
  const branchesRead: ThreadId[] = []
  const ownReads: ThreadId[] = []

  for (const event of seeded) {
    byThread.set(event.threadId, [...(byThread.get(event.threadId) ?? []), event])
    headByThread.set(event.threadId, Math.max(headByThread.get(event.threadId) ?? 0, event.seq))
  }

  let stamped = 0

  const reserve = ({ threadId, count }: { threadId: ThreadId; count: number }): number => {
    const from = (headByThread.get(threadId) ?? 0) + 1
    headByThread.set(threadId, from + count - 1)
    return from
  }

  const held = ({ threadId, upTo }: { threadId: ThreadId; upTo?: number }): Event[] => {
    const rows = byThread.get(threadId) ?? []
    return upTo === undefined ? [...rows] : rows.filter((event) => event.seq <= upTo)
  }

  return {
    branchesRead,
    ownReads,

    load(events) {
      byThread.clear()
      headByThread.clear()
      for (const event of events) {
        byThread.set(event.threadId, [...(byThread.get(event.threadId) ?? []), event])
        headByThread.set(event.threadId, Math.max(headByThread.get(event.threadId) ?? 0, event.seq))
      }
    },

    peek({ threadId }) {
      return [...(byThread.get(threadId) ?? [])]
    },

    async append({ threadId, runId, drafts }) {
      const firstSeq = reserve({ threadId, count: drafts.length })

      const written = drafts.map((draft, index) => {
        stamped += 1
        return stampEvent({
          draft,
          envelope: {
            id: toEventId(`event-${stamped}`),
            seq: firstSeq + index,
            threadId,
            runId,
            depth: 0,
            at: AT,
          },
        })
      })

      byThread.set(threadId, [...(byThread.get(threadId) ?? []), ...written])
      return written
    },

    async replace({ threadId, runId, drafts }) {
      const written = drafts.map((draft, index) => {
        stamped += 1
        return stampEvent({
          draft,
          envelope: {
            id: toEventId(`event-${stamped}`),
            seq: index + 1,
            threadId,
            runId,
            depth: 0,
            at: AT,
          },
        })
      })

      byThread.set(threadId, written)
      headByThread.set(threadId, written.length)
      return written
    },

    truncate({ threadId, toSeq }) {
      byThread.set(threadId, held({ threadId, upTo: toSeq }))
      headByThread.set(threadId, toSeq)
    },

    async read({ threadId, upTo }) {
      branchesRead.push(threadId)
      return held({ threadId, ...(upTo === undefined ? {} : { upTo }) })
    },

    async head({ threadId }) {
      return headByThread.get(threadId) ?? 0
    },

    async refresh() {},

    async readOwn({ threadId, upTo }) {
      ownReads.push(threadId)
      return held({ threadId, ...(upTo === undefined ? {} : { upTo }) })
    },
  }
}
