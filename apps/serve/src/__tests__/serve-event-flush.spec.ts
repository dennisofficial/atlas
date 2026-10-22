import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import type { PodEvent } from '@dltech/atlas-wire'

import { createEventFlusher, EFlushReply, type FlushReply } from '../serve-event-flush'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { scratchTranscriptStore } from './transcript-store-fixture'

const threadId = toThreadId('thread-flush')

const seeded = async (texts: readonly string[]) => {
  const store = scratchTranscriptStore({ prefix: 'flush' })
  for (const text of texts) {
    await store.log.append({
      threadId,
      runId: toRunId('run-1'),
      drafts: [{ type: 'user-said', text }],
    })
  }
  return store
}

const recordingPost = (reply: (events: readonly PodEvent[]) => FlushReply) => {
  const posted: PodEvent[][] = []
  return {
    posted,
    post: async (events: readonly PodEvent[]) => {
      posted.push([...events])
      return reply(events)
    },
  }
}

const stored = (events: readonly PodEvent[]): FlushReply => ({
  kind: EFlushReply.Stored,
  head: events.at(-1)?.seq ?? 0,
})

describe('createEventFlusher', () => {
  it('ships events past the durable head with their seqs and advances the head', async () => {
    const store = await seeded(['one', 'two', 'three'])
    const api = recordingPost(stored)
    const lines: ServeLogLine[] = []
    const flusher = createEventFlusher({
      threadId,
      events: store.log,
      durableHead: 1,
      post: api.post,
      truncate: async (toSeq) => toSeq,
      log: (line) => lines.push(line),
    })

    expect(await flusher.flush()).toBe(true)

    expect(api.posted.map((batch) => batch.map((event) => event.seq))).toEqual([[2, 3]])
    expect(JSON.parse(api.posted[0]?.[0]?.body ?? '{}')).toMatchObject({
      type: 'user-said',
      text: 'two',
    })
    expect(flusher.durableHead()).toBe(3)
    expect(await flusher.flush()).toBe(true)
    expect(api.posted).toHaveLength(1)
    expect(lines.map((line) => line.event)).toContain(EServeEvent.EventsFlushed)
  })

  it('logs a conflict loudly, reports failure and keeps the durable head', async () => {
    const store = await seeded(['one', 'two'])
    const api = recordingPost(() => ({ kind: EFlushReply.Conflict, seq: 2 }))
    const lines: ServeLogLine[] = []
    const flusher = createEventFlusher({
      threadId,
      events: store.log,
      durableHead: 1,
      post: api.post,
      truncate: async (toSeq) => toSeq,
      log: (line) => lines.push(line),
    })

    expect(await flusher.flush()).toBe(false)

    expect(flusher.durableHead()).toBe(1)
    expect(lines).toContainEqual(
      expect.objectContaining({ event: EServeEvent.EventFlushConflict, seq: 2 }),
    )
  })

  it('reports a network failure without advancing, and retries on the next flush', async () => {
    const store = await seeded(['one'])
    let fail = true
    const lines: ServeLogLine[] = []
    const flusher = createEventFlusher({
      threadId,
      events: store.log,
      durableHead: 0,
      truncate: async (toSeq) => toSeq,
      post: async (events) => {
        if (fail) throw new Error('the control plane answered 503')
        return stored(events)
      },
      log: (line) => lines.push(line),
    })

    expect(await flusher.flush()).toBe(false)
    expect(flusher.durableHead()).toBe(0)
    expect(lines.map((line) => line.event)).toContain(EServeEvent.EventFlushFailed)

    fail = false
    expect(await flusher.flush()).toBe(true)
    expect(flusher.durableHead()).toBe(1)
  })

  it('runs one flush at a time and coalesces triggers that arrive meanwhile', async () => {
    const store = await seeded(['one', 'two'])
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const flusher = createEventFlusher({
      threadId,
      events: store.log,
      durableHead: 0,
      truncate: async (toSeq) => toSeq,
      post: async (events) => {
        calls += 1
        if (calls === 1) await held
        return stored(events)
      },
      log: () => undefined,
    })

    const first = flusher.flush()
    const second = flusher.flush()
    const third = flusher.flush()
    release()

    expect(await Promise.all([first, second, third])).toEqual([true, true, true])
    expect(second).toBe(third)
    expect(calls).toBe(1)
    expect(flusher.durableHead()).toBe(2)
  })
})

describe('createEventFlusher rebase', () => {
  it('truncates Postgres below the edit, then re-ships the local tail with its gaps', async () => {
    const store = await seeded(['one', 'two', 'three', 'four'])
    const api = recordingPost(stored)
    const truncated: number[] = []
    const flusher = createEventFlusher({
      threadId,
      events: store.log,
      durableHead: 4,
      post: api.post,
      truncate: async (toSeq) => {
        truncated.push(toSeq)
        return toSeq
      },
      log: () => undefined,
    })

    expect(await flusher.rebase({ toSeq: 2 })).toBe(true)

    expect(truncated).toEqual([2])
    expect(api.posted.map((batch) => batch.map((event) => event.seq))).toEqual([[3, 4]])
    expect(flusher.durableHead()).toBe(4)
  })

  it('skips the truncate when nothing durable sits above the edit', async () => {
    const store = await seeded(['one'])
    const truncated: number[] = []
    const flusher = createEventFlusher({
      threadId,
      events: store.log,
      durableHead: 1,
      post: recordingPost(stored).post,
      truncate: async (toSeq) => {
        truncated.push(toSeq)
        return toSeq
      },
      log: () => undefined,
    })

    expect(await flusher.rebase({ toSeq: 5 })).toBe(true)
    expect(truncated).toEqual([])
  })

  it('reports failure and keeps the head when the truncate fails', async () => {
    const store = await seeded(['one', 'two'])
    const api = recordingPost(stored)
    const flusher = createEventFlusher({
      threadId,
      events: store.log,
      durableHead: 2,
      post: api.post,
      truncate: async () => {
        throw new Error('the control plane answered 503')
      },
      log: () => undefined,
    })

    expect(await flusher.rebase({ toSeq: 1 })).toBe(false)
    expect(flusher.durableHead()).toBe(2)
    expect(api.posted).toEqual([])
  })
})
