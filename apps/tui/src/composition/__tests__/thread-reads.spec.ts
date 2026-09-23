import {
  EventLogPort,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type ThreadId,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  createThreadPager,
  mergeWindowEvents,
  retainNewest,
  retainOldest,
  THREAD_RETENTION_EVENTS,
  THREAD_WINDOW_EVENTS,
} from '../thread-reads'
import { EThreadRows } from '../use-thread-view'

const THREAD = toThreadId('thread-reads-spec')
const RUN = toRunId('run-reads-spec')
const AT = '2026-01-01T00:00:00.000Z'

const range = (from: number, to: number): Event[] =>
  stampDrafts({
    drafts: Array.from({ length: to - from + 1 }, (_, index) => ({
      type: 'user-said' as const,
      text: `message ${from + index}`,
    })),
    envelopes: Array.from({ length: to - from + 1 }, (_, index) => ({
      id: toEventId(`event-${from + index}`),
      seq: from + index,
      threadId: THREAD,
      runId: RUN,
      depth: 0,
      at: AT,
    })),
  })

const seqs = (events: readonly Event[]): number[] => events.map((event) => event.seq)

class MemoryLog extends EventLogPort {
  constructor(private readonly rows: readonly Event[]) {
    super()
  }

  override async read(args: { threadId: ThreadId; fromSeq?: number; upTo?: number }): Promise<Event[]> {
    return this.slice(args)
  }

  override async readOwn(args: { threadId: ThreadId; fromSeq?: number; upTo?: number }): Promise<Event[]> {
    return this.slice(args)
  }

  override async head(): Promise<number> {
    return this.rows.at(-1)?.seq ?? 0
  }

  override async append(): Promise<Event[]> {
    throw new Error('the spec log does not append')
  }

  override async replace(): Promise<Event[]> {
    throw new Error('the spec log does not replace')
  }

  private slice(args: { fromSeq?: number; upTo?: number }): Event[] {
    return this.rows.filter(
      (event) =>
        (args.fromSeq === undefined || event.seq > args.fromSeq) &&
        (args.upTo === undefined || event.seq <= args.upTo),
    )
  }
}

function pagerOn(args: { rows: readonly Event[]; held: readonly Event[] }) {
  let current = args.held
  let gapped = false
  const pager = createThreadPager({
    log: new MemoryLog(args.rows),
    threadId: THREAD,
    rows: EThreadRows.Own,
    held: () => current,
    gapped: () => gapped,
    markGapped: (next) => {
      gapped = next
    },
    apply: (next) => {
      current = next
    },
  })

  return {
    pager,
    events: () => current,
    gapped: () => gapped,
  }
}

describe('mergeWindowEvents', () => {
  it('returns the window itself when it exactly replaces what is held', () => {
    const held = range(3, 6)
    const window = range(3, 6)
    expect(mergeWindowEvents({ held, window })).toBe(window)
  })

  it('keeps the held prefix ahead of the window anchor', () => {
    const merged = mergeWindowEvents({ held: range(1, 4), window: range(3, 5) })
    expect(seqs(merged ?? [])).toEqual([1, 2, 3, 4, 5])
  })

  it('answers null when the window anchor was never held', () => {
    expect(mergeWindowEvents({ held: range(1, 3), window: range(7, 9) })).toBeNull()
  })

  it('answers the window when the window is empty', () => {
    const merged = mergeWindowEvents({ held: range(1, 3), window: [] })
    expect(merged).toEqual([])
  })
})

describe('retention trims', () => {
  it('retainOldest drops from the tail and says so', () => {
    const retained = retainOldest({ events: range(1, 5), cap: 3 })
    expect(seqs(retained.events)).toEqual([1, 2, 3])
    expect(retained.evictedTail).toBe(true)
  })

  it('retainOldest leaves an under-cap window alone', () => {
    const events = range(1, 3)
    const retained = retainOldest({ events, cap: 3 })
    expect(retained.events).toBe(events)
    expect(retained.evictedTail).toBe(false)
  })

  it('retainNewest drops from the head', () => {
    expect(seqs(retainNewest({ events: range(1, 5), cap: 3 }))).toEqual([3, 4, 5])
  })
})

describe('a thread pager', () => {
  it('prepends older chunks without evicting while under the cap', async () => {
    const rows = range(1, 2_000)
    const state = pagerOn({ rows, held: rows.slice(1_000) })

    await state.pager.loadOlder()

    expect(state.events()[0]?.seq).toBe(1)
    expect(state.events().length).toBe(2_000)
    expect(state.gapped()).toBe(false)
  })

  it('evicts the newest events once prepending passes the retention cap', async () => {
    const rows = range(1, 4_000)
    const state = pagerOn({ rows, held: rows.slice(2_500) })

    await state.pager.loadOlder()
    await state.pager.loadOlder()

    expect(state.events().length).toBe(THREAD_RETENTION_EVENTS)
    expect(state.events()[0]?.seq).toBe(1)
    expect(state.events().at(-1)?.seq).toBe(THREAD_RETENTION_EVENTS)
    expect(state.gapped()).toBe(true)
  })

  it('pages the tail gap closed from the log, staying inside the cap', async () => {
    const rows = range(1, 10_000)
    const state = pagerOn({ rows, held: rows.slice(8_500) })

    await state.pager.loadOlder()
    await state.pager.loadOlder()
    await state.pager.loadOlder()
    expect(state.gapped()).toBe(true)
    expect(state.events()[0]?.seq).toBe(4_001)
    expect(state.events().at(-1)?.seq).toBe(7_000)

    await state.pager.loadNewer()

    expect(state.events().length).toBeLessThanOrEqual(THREAD_RETENTION_EVENTS)
    expect(state.events()[0]?.seq).toBe(5_501)
    expect(state.events().at(-1)?.seq).toBe(8_500)
    expect(state.gapped()).toBe(true)

    await state.pager.loadNewer()

    expect(state.gapped()).toBe(false)
    expect(state.events().at(-1)?.seq).toBe(10_000)
    expect(state.events().length).toBeLessThanOrEqual(THREAD_RETENTION_EVENTS)
  })

  it('clears the gap once the tail of the log is reached', async () => {
    const rows = range(1, 4_000)
    const state = pagerOn({ rows, held: rows.slice(2_500) })

    await state.pager.loadOlder()
    await state.pager.loadOlder()
    expect(state.gapped()).toBe(true)

    await state.pager.loadNewer()

    expect(state.gapped()).toBe(false)
    expect(state.events().at(-1)?.seq).toBe(4_000)
    expect(state.events().length).toBeLessThanOrEqual(THREAD_RETENTION_EVENTS)
    expect(state.events().at(-1)).toBe(rows.at(-1))
  })

  it('does not page newer while no gap is open', async () => {
    const rows = range(1, 100)
    const state = pagerOn({ rows, held: rows.slice(50) })

    await state.pager.loadNewer()

    expect(state.events().length).toBe(50)
  })
})
