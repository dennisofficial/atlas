import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type Event, type ThreadId } from '@dltech/atlas-core'
import { transcriptIdentityDigest } from '@dltech/atlas-harness'

import { readThreadSnapshot, THREAD_WINDOW_EVENTS } from '../thread-reads'
import { EThreadRows } from '../use-thread-view'
import { fakeEventLog, SPEC_SHARD } from './fake-backend'

const THREAD: ThreadId = toThreadId(`snapshot-${SPEC_SHARD}`)
const AT = '2026-10-01T00:00:00.000Z'

const said = (text: string, seq: number): Event => ({
  type: 'user-said',
  text,
  id: toEventId(`e-${THREAD}-${seq}`),
  seq,
  threadId: THREAD,
  runId: toRunId('r1'),
  depth: 0,
  at: AT,
})

const effects = () => undefined

describe('readThreadSnapshot', () => {
  it('derives the window, the base and the identity from one read of the same events', async () => {
    const events = Array.from({ length: 50 }, (_, i) => said(`said ${i + 1}`, i + 1))
    const log = fakeEventLog(events)

    const snapshot = await readThreadSnapshot({
      log,
      threadId: THREAD,
      rows: EThreadRows.Composed,
      effects,
      digest: transcriptIdentityDigest,
    })

    expect(snapshot.events).toEqual(events)
    expect(snapshot.head).toBe(50)
    expect(snapshot.fromSeq).toBe(0)
    expect(snapshot.identity).toEqual({
      head: 50,
      count: 50,
      digest: transcriptIdentityDigest(events),
    })
  })

  it('keeps the full identity past the retention window while the window holds only the tail', async () => {
    const total = THREAD_WINDOW_EVENTS * 2 + 200
    const events = Array.from({ length: total }, (_, i) => said(`said ${i + 1}`, i + 1))
    const log = fakeEventLog(events)

    const snapshot = await readThreadSnapshot({
      log,
      threadId: THREAD,
      rows: EThreadRows.Composed,
      effects,
      digest: transcriptIdentityDigest,
    })

    expect(snapshot.events).toHaveLength(THREAD_WINDOW_EVENTS)
    expect(snapshot.events[0]?.seq).toBe(total - THREAD_WINDOW_EVENTS + 1)
    expect(snapshot.identity.count).toBe(total)
    expect(snapshot.identity.head).toBe(total)
    expect(snapshot.identity.digest).toBe(transcriptIdentityDigest(events))
  })

  it('can never have the window and the identity disagree about an append that lands mid-open', async () => {
    const events = Array.from({ length: 10 }, (_, i) => said(`said ${i + 1}`, i + 1))
    const log = fakeEventLog(events)

    const snapshot = await readThreadSnapshot({
      log,
      threadId: THREAD,
      rows: EThreadRows.Composed,
      effects,
      digest: transcriptIdentityDigest,
    })
    await log.append({ threadId: THREAD, runId: toRunId('r2'), drafts: [{ type: 'user-said', text: 'late' }] })

    const full = await log.read({ threadId: THREAD })
    expect(full).toHaveLength(11)
    expect(snapshot.identity.count).toBe(10)
    expect(snapshot.events.at(-1)?.seq).toBe(snapshot.identity.head)
  })

  it('reads a same-seq rewind as a different identity, so freshness can never call it synced', async () => {
    const before = Array.from({ length: 8 }, (_, i) => said(`said ${i + 1}`, i + 1))
    const first = await readThreadSnapshot({
      log: fakeEventLog(before),
      threadId: THREAD,
      rows: EThreadRows.Composed,
      effects,
      digest: transcriptIdentityDigest,
    })

    // A rewind re-appends fresh event ids at the same seqs — the identity digest is over
    // [id, seq, type], so same-seq rows with new ids are a different transcript.
    const rewound = Array.from({ length: 8 }, (_, i) => ({
      ...said(`else ${i + 1}`, i + 1),
      id: toEventId(`rewound-${THREAD}-${i + 1}`),
    }))
    const second = await readThreadSnapshot({
      log: fakeEventLog(rewound),
      threadId: THREAD,
      rows: EThreadRows.Composed,
      effects,
      digest: transcriptIdentityDigest,
    })

    expect(second.identity.head).toBe(first.identity.head)
    expect(second.identity.count).toBe(first.identity.count)
    expect(second.identity.digest).not.toBe(first.identity.digest)
  })
})
