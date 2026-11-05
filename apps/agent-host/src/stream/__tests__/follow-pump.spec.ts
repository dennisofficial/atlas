import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EStreamErrorCode, EStreamResetReason } from '@dltech/atlas-protocol'

import { FollowRig, said, SESSION, THREAD } from './follow-rig'

describe('follow pump', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  it('opens at the tail: the last 1000 events in pages, live only after the last', async () => {
    await rig.seed({ events: 1200 })
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(1200)
    expect(rig.seqs()).toEqual(Array.from({ length: 1000 }, (_, n) => 201 + n))
    const live = rig.frames('events').map((frame) => frame.live)
    expect(live.slice(0, -1).every((flag) => !flag)).toBe(true)
    expect(live.at(-1)).toBe(true)
    expect(rig.frames('events').at(-1)?.head.seq).toBe(1200)
    expect(rig.frames('reset')).toEqual([])
  })

  it('resumes exactly after a matching cursor', async () => {
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
    expect(rig.seqs()).toEqual([6, 7, 8, 9, 10])
    expect(rig.frames('reset')).toEqual([])
  })

  it('resets ahead when the cursor is past the head', async () => {
    await rig.seed({ events: 10 })
    await rig.subscribe({ session: rig.open(), afterSeq: 50, afterHash: 'whatever' })
    await rig.untilSeq(10)
    expect(rig.frames('reset')).toEqual([
      { type: 'reset', id: 'sub-1', reason: EStreamResetReason.Ahead, tailFrom: 0 },
    ])
    expect(rig.seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('resets as a fork when the hash at the cursor differs', async () => {
    await rig.seed({ events: 10 })
    await rig.subscribe({ session: rig.open(), afterSeq: 5, afterHash: 'f'.repeat(64) })
    await rig.untilSeq(10)
    expect(rig.frames('reset').map((frame) => frame.reason)).toEqual([EStreamResetReason.Fork])
    expect(rig.seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('resets too-far-behind past 1500 events and streams the tail', async () => {
    await rig.seed({ events: 1600 })
    const row = await rig.plane.readEvents({
      threadId: THREAD,
      afterSeq: 9,
      limit: 1,
      visible: false,
    })
    await rig.subscribe({
      session: rig.open(),
      afterSeq: 10,
      afterHash: rig.hashAt(row.events, 10),
    })
    await rig.untilSeq(1600)
    expect(rig.frames('reset')).toEqual([
      { type: 'reset', id: 'sub-1', reason: EStreamResetReason.TooFarBehind, tailFrom: 600 },
    ])
    expect(rig.seqs()[0]).toBe(601)
  })

  it('delivers an append made during the first read', async () => {
    await rig.seed({ events: 3 })
    let injected = false
    rig.onRead = async () => {
      if (injected) return
      injected = true
      await rig.append([said('late')])
    }
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(4)
    expect(rig.seqs()).toEqual([1, 2, 3, 4])
  })

  it('coalesces ten changes during one read into one more read', async () => {
    await rig.seed({ events: 3 })
    let injected = false
    rig.onRead = async () => {
      if (injected) return
      injected = true
      for (let n = 0; n < 10; n += 1) await rig.append([said(`burst-${n}`)])
    }
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(13)
    await rig.settled()
    expect(rig.reads).toBe(2)
    expect(rig.seqs()).toEqual(Array.from({ length: 13 }, (_, n) => n + 1))
  })

  it('treats a lease-only change as harmless', async () => {
    await rig.seed({ events: 2 })
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(2)
    const frames = rig.sent.length
    const reads = rig.reads
    await rig.plane.post({ sessionId: SESSION, kind: 'message', payload: 'hi' })
    await rig.settled()
    expect(rig.sent.length).toBe(frames)
    expect(rig.reads).toBe(reads)
  })

  it('stops sending after unsubscribe', async () => {
    await rig.seed({ events: 2 })
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.untilSeq(2)
    session.handle({ type: 'unsubscribe', id: 'sub-1' })
    await rig.append([said('after')])
    await rig.settled()
    expect(rig.seqs()).toEqual([1, 2])
  })

  it('releases subscriptions when the connection closes', async () => {
    await rig.seed({ events: 2 })
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.untilSeq(2)
    session.close()
    await rig.append([said('after')])
    await rig.settled()
    expect(rig.seqs()).toEqual([1, 2])
    expect(rig.timers.pendingCount()).toBe(0)
  })

  it('answers not-found to a user who does not own the session', async () => {
    await rig.seed({ events: 2 })
    await rig.subscribe({ session: rig.open('user-b') })
    await rig.settled()
    expect(rig.sent).toEqual([{ type: 'error', id: 'sub-1', code: EStreamErrorCode.NotFound }])
  })

  it('answers not-found to an unknown session', async () => {
    await rig.seed({ events: 0 })
    await rig.subscribe({ session: rig.open(), sessionId: 'missing' })
    await rig.settled()
    expect(rig.frames('error').map((frame) => frame.code)).toEqual([EStreamErrorCode.NotFound])
  })
})
