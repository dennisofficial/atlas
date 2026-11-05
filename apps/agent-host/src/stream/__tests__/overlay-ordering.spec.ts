import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EStepEndReason } from '@dltech/atlas-core'
import {
  EStreamBlockKind,
  EStreamClearReason,
  type LiveFrame,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { JOIN_RETRY_BASE_MS, MAX_JOIN_READS } from '../overlay/overlay-watcher'
import { STATUS_COALESCE_MS } from '../status-views'
import { FakeLiveSource } from './fake-live-source'
import { FollowRig, SESSION } from './follow-rig'
import { clientViewOf } from './overlay-client'

const OLD: StreamStepKey = { runId: 'run-a', step: 0, attempt: 0 }
const NEW: StreamStepKey = { runId: 'run-b', step: 0, attempt: 0 }

const delta = (args: { key: StreamStepKey; from: number; text: string }): LiveFrame => ({
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

  const publish = (frame: LiveFrame, deliver = true): void =>
    live.publish({ sessionId: SESSION, frame, deliver })

  const recheckStatus = async (): Promise<void> => {
    await rig.plane.wake({ sessionIds: [SESSION] })
    rig.timers.advance(STATUS_COALESCE_MS)
    await rig.settled()
  }

  it('keeps the newer run when its step-start was lost and a gap lands during the join', async () => {
    live.beforeRead = () => {
      live.beforeRead = undefined
      publish({ type: 'step-start', key: OLD })
      publish(delta({ key: OLD, from: 0, text: 'OLD' }))
      publish({ type: 'step-end', key: OLD, reason: EStepEndReason.Finished })
      publish({ type: 'step-start', key: NEW }, false)
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
    expect(rig.frames('view').at(-1)?.value.lease.live).toBe(false)
    rig.store.markHostPresent(1)
    publish({ type: 'step-start', key: NEW }, false)
    publish(delta({ key: NEW, from: 0, text: 'abc' }), false)
    await session.handle({ type: 'resnap', id: 'sub-1' })
    await rig.settled()
    await recheckStatus()
    expect(rig.frames('view').at(-1)?.value.lease.live).toBe(true)
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'abc' })
    publish(delta({ key: NEW, from: 3, text: 'def' }))
    await rig.settled()
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'abcdef' })
  })

  it('clears on a not-live read even when the last delta arrived in the same millisecond', async () => {
    publish({ type: 'step-start', key: OLD })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    rig.timers.advance(STATUS_COALESCE_MS)
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
    publish({ type: 'step-start', key: NEW })
    publish(delta({ key: NEW, from: 0, text: 'abc' }))
    await rig.settled()
    expect(live.reads).toBe(bufferReads)
    rig.timers.advance(STATUS_COALESCE_MS)
    await rig.settled()
    expect(rig.statusReads).toBe(reads + 1)
  })

  it('measures the join queue in utf-8 bytes', async () => {
    const text = '字'.repeat(4096)
    publish({ type: 'step-start', key: NEW })
    live.afterCapture = () => {
      live.afterCapture = undefined
      for (let n = 0; n < 60; n += 1) publish(delta({ key: NEW, from: n * 4096, text }))
    }
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(live.reads).toBe(2)
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: text.repeat(60) })
  })

  it('bounds the reads of one join when resnaps keep arriving', async () => {
    const session = rig.open()
    live.beforeRead = () => session.handle({ type: 'resnap', id: 'sub-1' })
    await rig.subscribe({ session })
    await rig.settled()
    live.beforeRead = undefined
    expect(live.reads).toBe(MAX_JOIN_READS)
  })

  it('keeps a step that starts after the read boundary when the last capped read overflows', async () => {
    publish({ type: 'step-start', key: OLD })
    publish(delta({ key: OLD, from: 0, text: 'a' }))
    const session = rig.open()
    let reads = 0
    let from = 1
    live.beforeRead = async () => {
      reads += 1
      if (reads >= MAX_JOIN_READS) return
      for (let n = 0; n < 20; n += 1) {
        publish(delta({ key: OLD, from, text: 'b' }))
        from += 1
      }
      await session.handle({ type: 'resnap', id: 'sub-1' })
    }
    live.afterCapture = () => {
      if (reads !== MAX_JOIN_READS) return
      live.afterCapture = undefined
      const big = 'x'.repeat(4096)
      for (let n = 0; n < 70; n += 1) {
        publish(delta({ key: OLD, from, text: big }))
        from += big.length
      }
      publish({ type: 'step-start', key: NEW })
      publish(delta({ key: NEW, from: 0, text: 'NEW' }))
    }
    await rig.subscribe({ session })
    await rig.settled()
    live.beforeRead = undefined
    rig.timers.advance(JOIN_RETRY_BASE_MS)
    await rig.settled()
    publish(delta({ key: NEW, from: 3, text: '!' }))
    await rig.settled()
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'NEW!' })
  })

  it('backs off instead of re-reading in a loop while the buffer read keeps failing', async () => {
    publish({ type: 'step-start', key: NEW })
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

  it('re-reads after an overflow on the last capped read even when no frame follows', async () => {
    publish({ type: 'step-start', key: OLD })
    publish(delta({ key: OLD, from: 0, text: 'a' }))
    const session = rig.open()
    let reads = 0
    live.beforeRead = async () => {
      reads += 1
      if (reads < MAX_JOIN_READS) await session.handle({ type: 'resnap', id: 'sub-1' })
    }
    live.afterCapture = () => {
      if (reads !== MAX_JOIN_READS) return
      live.afterCapture = undefined
      publish(delta({ key: OLD, from: 1, text: 'y'.repeat(300 * 1024) }))
    }
    await rig.subscribe({ session })
    await rig.settled()
    live.beforeRead = undefined
    rig.timers.advance(JOIN_RETRY_BASE_MS)
    await rig.settled()
    expect(clientViewOf(rig.sent).text).toHaveLength(1 + 300 * 1024)
  })
})
