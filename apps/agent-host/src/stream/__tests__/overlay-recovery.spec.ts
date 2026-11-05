import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EStepEndReason } from '@dltech/atlas-core'
import {
  EStreamBlockKind,
  EStreamClearReason,
  type LiveFrame,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { FOLLOW_HIGH_WATER_BYTES } from '../follow-limits'
import { STATUS_COALESCE_MS } from '../status-views'
import { FakeLiveSource } from './fake-live-source'
import { clientViewOf } from './overlay-client'
import { FollowRig, SESSION } from './follow-rig'

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

describe('live overlay recovery', () => {
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

  const publish = (frame: LiveFrame): void => live.publish({ sessionId: SESSION, frame })

  it('keeps the newer run when an older run is queued behind the snapshot', async () => {
    live.beforeRead = () => {
      live.beforeRead = undefined
      publish({ type: 'step-start', key: OLD, afterSeq: 0 })
      publish(delta({ key: OLD, from: 0, text: 'OLD' }))
      publish({ type: 'step-end', key: OLD, reason: EStepEndReason.Finished })
      publish({ type: 'step-start', key: NEW, afterSeq: 0 })
      publish(delta({ key: NEW, from: 0, text: 'NEW' }))
    }
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    publish(delta({ key: NEW, from: 3, text: '!' }))
    await rig.settled()
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'NEW!' })
    expect(rig.frames('overlay').map((m) => m.key.runId)).not.toContain('run-a')
  })

  it('keeps the newer run when a resync lands during the join', async () => {
    publish({ type: 'step-start', key: OLD, afterSeq: 0 })
    publish(delta({ key: OLD, from: 0, text: 'OLD' }))
    const session = rig.open()
    live.beforeRead = async () => {
      live.beforeRead = undefined
      await session.handle({ type: 'resnap', id: 'sub-1' })
      publish({ type: 'step-end', key: OLD, reason: EStepEndReason.Finished })
      publish({ type: 'step-start', key: NEW, afterSeq: 0 })
      publish(delta({ key: NEW, from: 0, text: 'NEW' }))
    }
    await rig.subscribe({ session })
    await rig.settled()
    expect(live.reads).toBe(2)
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: 'NEW' })
  })

  it('clears a dead holder overlay for a subscriber that joins after the holder died', async () => {
    rig.store.markHostAbsent(1)
    publish({ type: 'step-start', key: OLD, afterSeq: 0 })
    publish(delta({ key: OLD, from: 0, text: 'dead' }))
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(clientViewOf(rig.sent).key).toBeUndefined()
  })

  it('does not open a dead holder step for a subscriber whose first read was in flight', async () => {
    publish({ type: 'step-start', key: OLD, afterSeq: 0 })
    publish(delta({ key: OLD, from: 0, text: 'abc' }))
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.settled()
    let readDone: () => void = () => undefined
    const read = new Promise<void>((resolve) => {
      readDone = resolve
    })
    live.beforeRead = async () => {
      live.beforeRead = undefined
      rig.store.markHostAbsent(1)
      await rig.plane.wake({ sessionIds: [SESSION] })
      rig.timers.advance(STATUS_COALESCE_MS)
      await rig.settled()
    }
    live.afterCapture = () => {
      live.afterCapture = undefined
      readDone()
    }
    await rig.subscribe({ session, id: 'sub-2' })
    await read
    await rig.settled()
    const second = rig.sent.filter((message) => 'id' in message && message.id === 'sub-2')
    expect(clientViewOf(second).key).toBeUndefined()
  })

  it('bounds the frames held during a stalled read and re-reads instead', async () => {
    const text = 'x'.repeat(4096)
    publish({ type: 'step-start', key: NEW, afterSeq: 0 })
    live.afterCapture = () => {
      live.afterCapture = undefined
      for (let n = 0; n < 100; n += 1) publish(delta({ key: NEW, from: n * 4096, text }))
    }
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(live.reads).toBe(2)
    expect(clientViewOf(rig.sent)).toEqual({ key: NEW, text: text.repeat(100) })
  })

  it('delivers the end of a step whose step-end was dropped under backpressure', async () => {
    publish({ type: 'step-start', key: OLD, afterSeq: 0 })
    publish(delta({ key: OLD, from: 0, text: 'abc' }))
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    rig.buffered = FOLLOW_HIGH_WATER_BYTES
    publish({ type: 'step-end', key: OLD, reason: EStepEndReason.Finished })
    await rig.settled()
    rig.buffered = 0
    publish({ type: 'tool-output', callId: 'call-1', text: 'next' })
    await rig.settled()
    expect(
      rig
        .frames('frame')
        .map((m) => m.frame.type)
        .sort(),
    ).toEqual(['step-end', 'tool-output'])
    expect(clientViewOf(rig.sent).key).toBeUndefined()
  })
})
