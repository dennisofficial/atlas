import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EStepEndReason } from '@dltech/atlas-core'
import { EStreamBlockKind, EStreamClearReason, type StreamStepKey } from '@dltech/atlas-protocol'

import { JOIN_RETRY_BASE_MS } from '../overlay/overlay-watcher'
import { VIEW_COALESCE_MS } from '../session-views'
import { FakeLiveSource, type TestFrame } from './fake-live-source'
import { FollowRig, SESSION } from './follow-rig'
import { clientViewOf } from './overlay-client'

const OLD: StreamStepKey = { runId: 'run-a', step: 0, attempt: 0 }
const NEW: StreamStepKey = { runId: 'run-b', step: 0, attempt: 0 }

const delta = (args: { key: StreamStepKey; from: number; text: string }): TestFrame => ({
  type: 'delta',
  key: args.key,
  block: 'b1',
  kind: EStreamBlockKind.Text,
  from: args.from,
  text: args.text,
})

describe('live overlay ordering and liveness', () => {
  let live: FakeLiveSource
  let rig: FollowRig

  beforeEach(async () => {
    live = new FakeLiveSource()
    rig = new FollowRig({ live })
    rig.store.markHostPresent(1)
    await rig.seed({ events: 1 })
  })

  afterEach(() => {
    rig.dispose()
  })

  const publish = (frame: TestFrame, deliver = true): void =>
    live.publish({ sessionId: SESSION, frame, deliver })

  const recheckStatus = async (): Promise<void> => {
    await rig.plane.wake({ sessionIds: [SESSION] })
    rig.timers.advance(VIEW_COALESCE_MS)
    await rig.settled()
  }

  it('keeps the newer run when its step-start was lost and a gap lands during the join', async () => {
    live.beforeRead = () => {
      live.beforeRead = undefined
      publish({ type: 'step-start', key: OLD, afterSeq: 0 })
      publish(delta({ key: OLD, from: 0, text: 'OLD' }))
      publish({ type: 'step-end', key: OLD, reason: EStepEndReason.Finished })
      publish({ type: 'step-start', key: NEW, afterSeq: 0 }, false)
      publish(delta({ key: NEW, from: 0, text: 'NEW' }))
      live.gap()
    }
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    publish(delta({ key: NEW, from: 3, text: '!' }))
    await rig.settled()
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'NEW!' })
  })

  it('shows a step found while the holder read as dead, once it reads as live', async () => {
    rig.store.markHostAbsent(1)
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.settled()
    expect(rig.latestLease()?.live).toBe(false)
    rig.store.markHostPresent(1)
    publish({ type: 'step-start', key: NEW, afterSeq: 0 }, false)
    publish(delta({ key: NEW, from: 0, text: 'abc' }), false)
    await session.handle({ type: 'resnap', id: 'sub-1' })
    await rig.settled()
    await recheckStatus()
    expect(rig.latestLease()?.live).toBe(true)
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'abc' })
    publish(delta({ key: NEW, from: 3, text: 'def' }))
    await rig.settled()
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'abcdef' })
  })

  it('clears on a not-live read even when the last delta arrived in the same millisecond', async () => {
    publish({ type: 'step-start', key: OLD, afterSeq: 0 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    rig.timers.advance(VIEW_COALESCE_MS)
    publish(delta({ key: OLD, from: 0, text: 'last' }))
    rig.store.markHostAbsent(1)
    await rig.plane.wake({ sessionIds: [SESSION] })
    await rig.settled()
    expect(rig.frames('overlay-clear').at(-1)?.reason).toBe(EStreamClearReason.HolderLost)
    expect(clientViewOf(rig.sent).key).toBeUndefined()
  })

  it('a frame from a session read as dead asks for a fresh status instead of reading the buffer', async () => {
    rig.store.markHostAbsent(1)
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    const reads = rig.statusReads
    const bufferReads = live.reads
    publish({ type: 'step-start', key: NEW, afterSeq: 0 })
    publish(delta({ key: NEW, from: 0, text: 'abc' }))
    await rig.settled()
    expect(live.reads).toBe(bufferReads)
    rig.timers.advance(VIEW_COALESCE_MS)
    await rig.settled()
    expect(rig.statusReads).toBe(reads + 1)
  })

  it('measures the join queue in utf-8 bytes', async () => {
    const text = '字'.repeat(4096)
    publish({ type: 'step-start', key: NEW, afterSeq: 0 })
    live.afterCapture = () => {
      live.afterCapture = undefined
      for (let n = 0; n < 60; n += 1) publish(delta({ key: NEW, from: n * 4096, text }))
    }
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(live.reads).toBe(2)
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: text.repeat(60) })
  })

  it('joins after one read with no retry timer while live frames keep arriving', async () => {
    publish({ type: 'step-start', key: NEW, afterSeq: 0 })
    let from = 0
    const arrive = (): void => {
      publish(delta({ key: NEW, from, text: 'ab' }))
      from += 2
    }
    arrive()
    live.beforeRead = arrive
    live.afterCapture = arrive
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(live.reads).toBe(1)
    expect(rig.timers.pendingCount()).toBe(0)
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'ab'.repeat(3) })
  })

  it('ignores a late delta of a step closed more than 64 steps earlier', async () => {
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    for (let step = 0; step < 70; step += 1) {
      const key = { runId: 'run-a', step, attempt: 0 }
      publish({ type: 'step-start', key, afterSeq: 0 })
      publish(delta({ key, from: 0, text: 'x' }))
      publish({ type: 'step-end', key, reason: EStepEndReason.Finished })
      await rig.settled()
    }
    const before = rig.sent.length
    const reads = live.reads
    const first = { runId: 'run-a', step: 0, attempt: 0 }
    publish({ ...delta({ key: first, from: 1, text: 'late' }), at: { epoch: 1, n: 1 } }, true)
    await rig.settled()
    expect(rig.sent.length).toBe(before)
    expect(live.reads).toBe(reads)
  })

  it('backs off instead of re-reading in a loop while the buffer read keeps failing', async () => {
    publish({ type: 'step-start', key: NEW, afterSeq: 0 })
    live.failReads = 2
    live.beforeRead = () => {
      live.beforeRead = undefined
      publish(delta({ key: NEW, from: 0, text: 'abc' }))
    }
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(live.reads).toBe(1)
    rig.timers.advance(JOIN_RETRY_BASE_MS)
    await rig.settled()
    expect(live.reads).toBe(2)
    rig.timers.advance(JOIN_RETRY_BASE_MS * 2)
    await rig.settled()
    expect(live.reads).toBe(3)
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'abc' })
  })
})
