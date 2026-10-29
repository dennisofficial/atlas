import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor, type Event, toRunId, toThreadId } from '@dltech/atlas-core'

import { lowestChangedSeq, mirrorHistoryEdits } from '../serve-history-mirror'
import type { ServeApp } from '../serve-app'
import { scratchTranscriptStore } from './transcript-store-fixture'

const threadId = toThreadId('thread-mirror')

const seededEvents = async (count: number): Promise<Event[]> => {
  const store = scratchTranscriptStore({ prefix: 'mirror' })
  for (let index = 1; index <= count; index += 1) {
    await store.log.append({
      threadId,
      runId: toRunId('run-1'),
      drafts: [{ type: 'user-said', text: `message ${index}` }],
    })
  }
  return store.log.read({ threadId })
}

const fakeFlusher = () => {
  const calls: string[] = []
  return {
    calls,
    flush: async () => {
      calls.push('flush')
      return true
    },
    rebase: async ({ toSeq }: { toSeq: number }) => {
      calls.push(`rebase:${toSeq}`)
      return true
    },
  }
}

const appOver = (current: { events: Event[] }) => {
  const log = { readOwn: async () => current.events } as unknown as ServeApp['log']
  return { log }
}

describe('lowestChangedSeq', () => {
  it('finds the lowest seq that was removed, added or rewritten', () => {
    const before = new Map([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ])
    expect(lowestChangedSeq({ before, after: new Map([[1, 'a']]) })).toBe(2)
    expect(lowestChangedSeq({ before, after: new Map(before) })).toBeUndefined()
    expect(lowestChangedSeq({ before, after: new Map([...before, [2, 'B']]) })).toBe(2)
  })
})

describe('mirrorHistoryEdits', () => {
  it('rebases Postgres below the lowest seq a rewind removed', async () => {
    const all = await seededEvents(4)
    const current = { events: all }
    const flusher = fakeFlusher()
    const app: Pick<ServeApp, 'log' | 'rewind' | 'compaction'> = {
      ...appOver(current),
      rewind: {
        target: {
          removeChildren: async () => undefined,
          removeShells: () => undefined,
          removeServices: () => undefined,
        },
        truncate: async ({ toSeq }) => {
          current.events = all.filter((event) => event.seq <= toSeq)
        },
      },
    }

    mirrorHistoryEdits({ app, flusherFor: () => flusher })
    await app.rewind?.truncate?.({ threadId, toSeq: 2, cutAgents: [] })
    await Promise.resolve()

    expect(flusher.calls).toEqual(['rebase:2'])
  })

  it('rebases below a summarise that rewrote the middle, and only flushes an append-only compact', async () => {
    const all = await seededEvents(4)
    const current = { events: all }
    const flusher = fakeFlusher()
    const [, second, third] = all
    const compaction = {
      summarise: async () => {
        current.events = all.filter((event) => event !== second && event !== third)
        return { type: 'compacted' }
      },
      compact: async () => ({ type: 'compacted' }),
    } as unknown as NonNullable<ServeApp['compaction']>
    const app = { ...appOver(current), compaction }

    mirrorHistoryEdits({ app, flusherFor: () => flusher })
    await app.compaction.summarise({ threadId, anchor: ECompactionAnchor.Prefix, seq: 3 })
    await app.compaction.compact({ threadId })
    await Promise.resolve()

    expect(flusher.calls).toEqual(['rebase:1', 'flush'])
  })
})
