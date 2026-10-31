import { describe, expect, it } from 'bun:test'

import { EDecision, toCallId, toEventId, toRunId, toThreadId, type Event } from '@dltech/atlas-core'

import { createApprovalWatcher } from '../index'

const threadId = toThreadId('approval')
const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve()
}
const approval = (args: { seq: number; answered?: boolean }): Event => ({
  id: toEventId(`event-${args.seq}`),
  seq: args.seq,
  threadId,
  runId: toRunId('run'),
  depth: 0,
  at: '2026-10-31T00:00:00Z',
  ...(args.answered
    ? { type: 'approval-answered', callId: toCallId('call'), decision: EDecision.Allow }
    : { type: 'approval-requested', callId: toCallId('call'), reason: 'permission' }),
})

describe('approval watcher', () => {
  it('retains the existing skipped first event and consecutive answer with exclusive reads', async () => {
    const stored = [approval({ seq: 1 })]
    const cursors: (number | undefined)[] = []
    const changes: boolean[] = []
    const watcher = createApprovalWatcher({
      threadId,
      log: {
        head: async () => stored.at(-1)?.seq ?? 0,
        readOwn: async ({ fromSeq }) => {
          cursors.push(fromSeq)
          return stored.filter((event) => event.seq > (fromSeq ?? 0))
        },
      },
      onChange: (waiting) => changes.push(waiting),
    })
    watcher.refresh()
    await flush()
    expect(changes).toEqual([false])
    stored.push(approval({ seq: 2 }))
    watcher.refresh()
    await flush()
    expect(changes).toEqual([false, true])
    stored.push(approval({ seq: 3, answered: true }))
    watcher.refresh()
    await flush()
    expect(changes).toEqual([false, true, true])
    expect(cursors).toEqual([1, 1, 3])
  })

  it('serializes refreshes and preserves the legacy inclusive-fake waiting sequence', async () => {
    const stored = [approval({ seq: 1 })]
    const changes: boolean[] = []
    const gate = Promise.withResolvers<void>()
    let reads = 0
    const watcher = createApprovalWatcher({
      threadId,
      log: {
        head: async () => {
          reads += 1
          if (reads === 1) await gate.promise
          return stored.at(-1)?.seq ?? 0
        },
        readOwn: async ({ fromSeq }) => stored.filter((event) => event.seq >= (fromSeq ?? 0)),
      },
      onChange: (waiting) => changes.push(waiting),
    })
    watcher.refresh()
    watcher.refresh()
    await flush()
    expect(reads).toBe(1)
    expect(changes).toEqual([])
    gate.resolve()
    await flush()
    expect(changes).toEqual([true, true])
    stored.push(approval({ seq: 2, answered: true }))
    watcher.refresh()
    await flush()
    expect(changes).toEqual([true, true, false])
  })

  it('resets on a smaller head but does not detect same-head replacement', async () => {
    let stored = [approval({ seq: 2 })]
    const changes: boolean[] = []
    const watcher = createApprovalWatcher({
      threadId,
      log: {
        head: async () => stored.at(-1)?.seq ?? 0,
        readOwn: async ({ fromSeq }) => stored.filter((event) => event.seq > (fromSeq ?? 0)),
      },
      onChange: (waiting) => changes.push(waiting),
    })
    watcher.refresh()
    await flush()
    stored = [approval({ seq: 2, answered: true })]
    watcher.refresh()
    await flush()
    expect(changes).toEqual([true, true])
    stored = []
    watcher.refresh()
    await flush()
    expect(changes).toEqual([true, true, false])
  })

  it('swallows head and own-read errors and accepts later refreshes', async () => {
    const changes: boolean[] = []
    let reads = 0
    const watcher = createApprovalWatcher({
      threadId,
      log: {
        head: async () => {
          reads += 1
          if (reads === 1) throw new Error('head unavailable')
          return 2
        },
        readOwn: async () => {
          if (reads === 2) throw new Error('history unavailable')
          return [approval({ seq: 2 })]
        },
      },
      onChange: (waiting) => changes.push(waiting),
    })
    watcher.refresh()
    watcher.refresh()
    await flush()
    expect(changes).toEqual([])
    watcher.refresh()
    await flush()
    expect(changes).toEqual([true])
  })
})
