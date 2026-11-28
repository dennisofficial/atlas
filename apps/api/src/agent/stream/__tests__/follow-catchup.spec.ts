import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { FOLLOW_HIGH_WATER_BYTES } from '../follow-limits'
import { FollowRig, OWNER, said, SESSION, THREAD } from './follow-rig'

const PAGE_READ = 2

describe('follow catch-up', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  it('delivers a rewind appended between pages of the first catch-up', async () => {
    await rig.seed({ events: 250 })
    let appended = false
    rig.onRead = async () => {
      if (appended || rig.reads !== PAGE_READ) return
      appended = true
      await rig.append([{ type: 'history-rewound', toSeq: 100 }, said('after rewind')])
    }
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(252)
    const seqs = rig.seqs()
    expect(seqs).toContain(251)
    expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b))
  })

  it('replays a long cold log from its first event, newest last', async () => {
    await rig.seed({ events: 0 })
    const text = 'x'.repeat(2_048)
    for (let batch = 0; batch < 10; batch += 1) {
      await rig.append(Array.from({ length: 100 }, () => said(text)))
    }
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(1_000)
    const events = rig.frames('events').flatMap((frame) => frame.events)
    expect(events[0]?.seq).toBe(1)
    expect(events.at(-1)?.seq).toBe(1_000)
  })

  it('reads the head once for a catch-up of many pages', async () => {
    await rig.seed({ events: 1_200 })
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(1_200)
    await rig.settled()

    expect(rig.frames('events')).toHaveLength(6)
    expect(rig.headReads).toBeLessThanOrEqual(3)
    expect(rig.frames('events').at(-1)?.live).toBe(true)
  })

  it('never calls a page live when the head it reports is ahead of it', async () => {
    await rig.seed({ events: 3 })
    let appended = false
    rig.onRead = async () => {
      if (appended || rig.reads !== 1) return
      appended = true
      await rig.append([said('raced')])
    }
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(4)
    for (const frame of rig.frames('events')) {
      if (!frame.live) continue
      expect(Number(frame.events.at(-1)?.seq ?? 0)).toBeGreaterThanOrEqual(frame.head.seq)
    }
    expect(rig.frames('events').at(-1)?.live).toBe(true)
  })
})

describe('session_catchup telemetry', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  const onlyCatchup = () => {
    const captures = rig.analytics.eventsOf('session_catchup')
    expect(captures).toHaveLength(1)
    const capture = captures[0]
    if (capture === undefined) throw new Error('no capture')
    return capture
  }

  it('captures one event for a cold catch-up across many pages', async () => {
    await rig.seed({ events: 1_200 })
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(1_200)
    await rig.settled()

    const capture = onlyCatchup()
    expect(capture.userId).toBe(OWNER)
    expect(capture.properties).toMatchObject({
      session_id: SESSION,
      pages: rig.frames('events').length,
      events: 1_200,
      start: 'cold',
      client: 'web',
      main_thread: true,
      cache: 'unknown',
      hydrate_ms: null,
      had_cursor: false,
      reset_reason: null,
      reached_live: true,
      behind_events: 1_200,
      drain_waits: 0,
    })
    expect(capture.properties).not.toHaveProperty('surface')
    expect(capture.properties.bytes).toBeGreaterThan(0)
    expect(capture.properties.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('marks a resumed catch-up as warm and counts only what it sent', async () => {
    await rig.seed({ events: 10 })
    const all = await rig.plane.readEvents({
      threadId: THREAD,
      afterSeq: 0,
      limit: 10,
      visible: false,
    })
    await rig.subscribe({
      session: rig.open(),
      afterSeq: 5,
      afterHash: rig.hashAt(all.events, 5),
    })
    await rig.untilSeq(10)
    await rig.settled()

    expect(onlyCatchup().properties).toMatchObject({
      start: 'warm',
      events: 5,
      pages: 1,
      behind_events: 5,
      reached_live: true,
    })
  })

  it('counts only the frames its own catch-up sent on a shared connection', async () => {
    await rig.seed({ events: 10 })
    const all = await rig.plane.readEvents({
      threadId: THREAD,
      afterSeq: 0,
      limit: 10,
      visible: false,
    })
    rig.onRead = async () => {
      rig.sendForeign({ type: 'snapshot', id: 'list', rows: [] })
    }
    await rig.subscribe({
      session: rig.open(),
      afterSeq: 5,
      afterHash: rig.hashAt(all.events, 5),
    })
    await rig.untilSeq(10)
    await rig.settled()

    const own = rig.frames('events')
    expect(own.length).toBeGreaterThan(0)
    expect(rig.frames('snapshot').length).toBeGreaterThan(0)
    const expected = own.reduce(
      (total, frame) => total + Buffer.byteLength(JSON.stringify(frame)),
      0,
    )
    expect(onlyCatchup().properties.bytes).toBe(expected)
  })

  it('marks a reset start as reset', async () => {
    await rig.seed({ events: 10 })
    await rig.subscribe({ session: rig.open(), afterSeq: 50, afterHash: 'whatever' })
    await rig.untilSeq(10)
    await rig.settled()

    expect(onlyCatchup().properties).toMatchObject({
      start: 'reset',
      events: 10,
      behind_events: 0,
      had_cursor: true,
      reset_reason: 'ahead',
      reached_live: true,
    })
  })

  it('reports reached_live false when stopped before the first page', async () => {
    await rig.seed({ events: 1_200 })
    rig.buffered = FOLLOW_HIGH_WATER_BYTES
    const session = rig.open()
    await rig.subscribe({ session })
    session.close()

    expect(onlyCatchup().properties).toMatchObject({
      start: 'cold',
      events: 0,
      pages: 0,
      reached_live: false,
      drain_waits: 1,
    })
  })

  it('captures nothing for a subscription that never passed begin', async () => {
    await rig.seed({ events: 10 })
    await rig.subscribe({ session: rig.open(), sessionId: 'missing' })
    await rig.settled()

    expect(rig.frames('error')).toHaveLength(1)
    expect(rig.analytics.eventsOf('session_catchup')).toHaveLength(0)
  })
})
