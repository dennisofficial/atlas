import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EStreamBlockKind, EStreamErrorCode, type StreamStepKey } from '@dltech/atlas-protocol'

import { FollowRig, said, SESSION } from './follow-rig'
import { FakeLiveSource } from './fake-live-source'

const CHILD = 'child-thread'
const STEP: StreamStepKey = { runId: 'run-1', step: 0, attempt: 0 }

describe('follow a child thread', () => {
  let rig: FollowRig
  let live: FakeLiveSource

  beforeEach(async () => {
    live = new FakeLiveSource()
    rig = new FollowRig({ live })
    await rig.seed({ events: 1 })
    await rig.plane.createThread({ threadId: CHILD, sessionId: SESSION })
    await rig.appendTo({ threadId: CHILD, bodies: [said('child-1'), said('child-2')] })
  })

  afterEach(() => {
    rig.dispose()
  })

  it('streams the events of the thread the client names', async () => {
    await rig.subscribe({ session: rig.open(), threadId: CHILD })
    await rig.untilSeq(2)
    expect(rig.seqs()).toEqual([1, 2])
    expect(rig.frames('events').at(-1)?.live).toBe(true)
  })

  it('leaves the main thread untouched when the client names only the main thread', async () => {
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(1)
    expect(rig.seqs()).toEqual([1])
  })

  it('answers not-found for an unknown thread', async () => {
    await rig.subscribe({ session: rig.open(), threadId: 'missing-thread' })
    await rig.settled()
    expect(rig.sent).toEqual([{ type: 'error', id: 'sub-1', code: EStreamErrorCode.NotFound }])
  })

  it('answers not-found for a thread of another session', async () => {
    await rig.seed({ events: 0, sessionId: 'session-2' })
    await rig.subscribe({ session: rig.open(), threadId: 'session-2-thread' })
    await rig.settled()
    expect(rig.frames('error').map((frame) => frame.code)).toEqual([EStreamErrorCode.NotFound])
  })

  it('stays off the main session view and follows the live overlay under the child key', async () => {
    await rig.subscribe({ session: rig.open(), threadId: CHILD })
    await rig.untilSeq(2)
    expect(rig.statusReads).toBe(0)
    expect(rig.frames('view')).toEqual([])
    expect([...live.subscribed]).toEqual([CHILD])
  })

  it('delivers live frames published on the child key to its follower', async () => {
    await rig.subscribe({ session: rig.open(), threadId: CHILD })
    await rig.untilSeq(2)
    live.publish({ key: CHILD, frame: { type: 'step-start', key: STEP, afterSeq: 0 } })
    live.publish({
      key: CHILD,
      frame: {
        type: 'delta',
        key: STEP,
        block: 'b1',
        kind: EStreamBlockKind.Text,
        from: 0,
        text: 'live',
      },
    })
    await rig.settled()
    expect(rig.frames('overlay')).toHaveLength(1)
    expect(rig.frames('delta').map((frame) => frame.text)).toEqual(['live'])
  })

  it('keeps the main session view for a main thread subscription', async () => {
    await rig.subscribe({ session: rig.open() })
    await rig.untilSeq(1)
    await rig.settled()
    expect(rig.statusReads).toBeGreaterThan(0)
    expect(live.subscribed.has(SESSION)).toBe(true)
  })
})
