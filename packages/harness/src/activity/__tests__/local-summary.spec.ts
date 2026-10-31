import { expect, test } from 'bun:test'
import { toThreadId, toEventId, toRunId, type Event, type EventLogPort } from '@dltech/atlas-core'
import { createLocalThreadSummary } from '../local-summary'
import { ELocalActivityState } from '../local-observer'

const threadId = toThreadId('root')
const assistant = (seq: number): Extract<Event, { type: 'assistant-said' }> => ({
  id: toEventId(`e${seq}`),
  seq,
  threadId,
  runId: toRunId('run'),
  depth: 0,
  at: '2026-10-31T00:00:00Z',
  type: 'assistant-said',
  parts: [],
})

test('failed activity preserves refreshed own history and the one shared cursor read', async () => {
  let refreshes = 0
  let cursorReads = 0
  const log: Pick<EventLogPort, 'refresh' | 'head' | 'readOwn'> = {
    refresh: async () => {
      refreshes += 1
    },
    head: async () => 9,
    readOwn: async () => [
      assistant(3),
      { ...assistant(8), type: 'user-said', text: 'not assistant' },
    ],
  }
  const summary = createLocalThreadSummary({
    log,
    cursor: {
      readSeq: async () => {
        cursorReads += 1
        return 2
      },
    },
    activity: {
      prepare: async () => undefined,
      read: async () => {
        throw new Error('secret endpoint')
      },
      close: () => undefined,
    },
  })
  expect(await summary.read({ threadId, head: 1 })).toEqual({
    head: 9,
    lastAssistantSeq: 3,
    readSeq: 2,
    activityState: ELocalActivityState.Unavailable,
    reason: 'Activity unavailable',
  })
  expect(refreshes).toBe(1)
  expect(cursorReads).toBe(1)
})

test('cursor failure is omitted while successful absence is null and history failure is separate', async () => {
  let cursorFailed = true
  let historyFailed = false
  const summary = createLocalThreadSummary({
    log: {
      refresh: async () => undefined,
      head: async () => 6,
      readOwn: async () => {
        if (historyFailed) throw new Error('unreadable')
        return [assistant(4)]
      },
    },
    cursor: {
      readSeq: async () => {
        if (cursorFailed) throw new Error('denied')
        return undefined
      },
    },
    activity: {
      prepare: async () => undefined,
      read: async () => ({
        activityState: ELocalActivityState.Unavailable,
        reason: 'Activity unavailable',
      }),
      close: () => undefined,
    },
  })
  const failedCursor = await summary.read({ threadId, head: 0 })
  expect(failedCursor.lastAssistantSeq).toBe(4)
  expect('readSeq' in failedCursor).toBe(false)
  cursorFailed = false
  historyFailed = true
  expect(await summary.read({ threadId, head: 0 })).toMatchObject({
    head: 6,
    lastAssistantSeq: null,
    readSeq: null,
  })
})

test('each refreshed own read replaces assistant sequence after shrink or same-head rewrite', async () => {
  let events: Event[] = [assistant(8)]
  const summary = createLocalThreadSummary({
    log: { refresh: async () => undefined, head: async () => 9, readOwn: async () => events },
    cursor: { readSeq: async () => 4 },
    activity: {
      prepare: async () => undefined,
      read: async () => ({
        activityState: ELocalActivityState.Unavailable,
        reason: 'Activity unavailable',
      }),
      close: () => undefined,
    },
  })
  expect((await summary.read({ threadId, head: 9 })).lastAssistantSeq).toBe(8)
  events = [assistant(2), { ...assistant(9), threadId: toThreadId('child') }]
  expect((await summary.read({ threadId, head: 9 })).lastAssistantSeq).toBe(2)
  events = []
  expect((await summary.read({ threadId, head: 9 })).lastAssistantSeq).toBe(0)
})
