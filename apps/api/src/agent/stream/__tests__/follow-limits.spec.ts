import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  EStreamClose,
  EStreamErrorCode,
  STREAM_MAX_SESSION_SUBSCRIPTIONS,
} from '@dltech/atlas-protocol'

import { FOLLOW_SLOW_CONSUMER_MS } from '../follow-limits'
import { FollowRig } from './follow-rig'

describe('follow limits', () => {
  let rig: FollowRig

  beforeEach(async () => {
    rig = new FollowRig()
    await rig.seed({ events: 3 })
  })

  afterEach(() => {
    rig.dispose()
  })

  it('refuses the 33rd session subscription', async () => {
    const session = rig.open()
    for (let n = 0; n < STREAM_MAX_SESSION_SUBSCRIPTIONS; n += 1) {
      await rig.subscribe({ session, id: `sub-${n}` })
      if (n % 10 === 9) rig.timers.advance(1_000)
    }
    expect(rig.frames('error')).toEqual([])
    await rig.subscribe({ session, id: 'sub-over' })
    expect(rig.frames('error')).toEqual([
      { type: 'error', id: 'sub-over', code: EStreamErrorCode.ForbiddenLimit },
    ])
  })

  it('refuses more than 20 subscribes in one second and recovers after', async () => {
    const session = rig.open()
    for (let n = 0; n < 20; n += 1) await rig.subscribe({ session, id: `sub-${n}` })
    await rig.subscribe({ session, id: 'sub-20' })
    expect(rig.frames('error').map((frame) => frame.id)).toEqual(['sub-20'])
    rig.timers.advance(1_000)
    await rig.subscribe({ session, id: 'sub-21' })
    expect(rig.frames('error')).toHaveLength(1)
  })

  it('answers bad-frame to a duplicate subscription id', async () => {
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.subscribe({ session })
    expect(rig.frames('error')).toEqual([
      { type: 'error', id: 'sub-1', code: EStreamErrorCode.BadFrame },
    ])
  })

  it('pauses reads above the high-water mark, closes 4408 after 30 s, and releases its timer', async () => {
    rig.buffered = 2_000_000
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(rig.reads).toBe(0)
    rig.timers.advance(FOLLOW_SLOW_CONSUMER_MS)
    await Bun.sleep(1)
    expect(rig.reads).toBe(0)
    expect(rig.closedWith).toEqual([EStreamClose.SlowConsumer])
    expect(rig.timers.pendingCount()).toBe(0)
  })

  it('resumes reading once the socket drains', async () => {
    rig.buffered = 2_000_000
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.settled()
    rig.timers.advance(1_000)
    await Bun.sleep(1)
    expect(rig.reads).toBe(0)
    rig.buffered = 0
    session.drain()
    await rig.untilSeq(3)
    expect(rig.closedWith).toEqual([])
  })

  it('waits for the socket to drain without polling it', async () => {
    rig.buffered = 2_000_000
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    rig.buffered = 0
    rig.timers.advance(FOLLOW_SLOW_CONSUMER_MS - 1)
    await Bun.sleep(1)
    expect(rig.reads).toBe(0)
    expect(rig.timers.pendingCount()).toBe(1)
  })
})
