import { describe, expect, it } from 'bun:test'

import {
  ELiveOpFailure,
  EPodCallKind,
  POD_STREAM_RENEW_EVERY_MS,
  POD_STREAM_TTL_MS,
} from '@dltech/atlas-protocol'

import { FakeClock } from '../../__tests__/rig-fakes'
import { FakePodCallBus, branchesFrame, fakePlaneOf } from './pod-route-fakes'
import { SESSION, STAT_OK, flush, makeRouter, runtimeOf } from './pod-router-rig'

const streamIdOf = (bus: FakePodCallBus): string => {
  const [follow] = bus.requests
  return follow !== undefined && 'streamId' in follow ? follow.streamId : ''
}

describe('PodRouter.follow', () => {
  it('follows the local runtime when this host holds it', async () => {
    const plane = fakePlaneOf({ holderHostId: 1, wantsHolder: true })
    const runtime = runtimeOf({ invoke: async () => STAT_OK })
    const { router } = makeRouter({ plane, runtime })
    const seen: string[] = []

    const dispose = await router.follow({
      sessionId: SESSION,
      listener: (frame) => seen.push(frame.event.type),
    })

    expect(dispose).not.toBeNull()
    dispose?.()
  })

  it('opens a stream on the holder host and forwards its frames', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    bus.answer = () => ({ state: 'open' })
    const { router } = makeRouter({ plane, bus, hostId: 1 })
    const seen: string[] = []
    const closed: string[] = []

    const dispose = await router.follow({
      sessionId: SESSION,
      listener: (frame) => seen.push(frame.event.type),
      onClose: (reason) => closed.push(reason),
    })

    expect(bus.requests[0]).toMatchObject({
      kind: EPodCallKind.Follow,
      sessionId: SESSION,
      targetHostId: 7,
      ttlMs: POD_STREAM_TTL_MS,
    })
    const streamId = streamIdOf(bus)
    expect(bus.listening(streamId)).toBe(true)

    bus.deliverFrame(streamId, { type: 'event', frame: branchesFrame() })
    expect(seen).toEqual(['git.branches'])

    bus.deliverFrame(streamId, { type: 'closed', reason: 'detached' })
    expect(closed).toEqual(['detached'])
    expect(bus.listening(streamId)).toBe(false)
    dispose?.()
  })

  it('renews the stream on the holder and closes it when the renew is refused', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    const clock = new FakeClock()
    let renews = 0
    bus.answer = (request) => {
      if (request.kind !== EPodCallKind.Renew) return { state: 'open' }
      renews += 1
      return renews === 1
        ? { state: 'open' }
        : { state: 'unavailable', reason: ELiveOpFailure.Absent }
    }
    const { router } = makeRouter({ plane, bus, hostId: 1, clock })
    const closed: string[] = []

    const dispose = await router.follow({
      sessionId: SESSION,
      listener: () => undefined,
      onClose: (reason) => closed.push(reason),
    })

    clock.advance(POD_STREAM_RENEW_EVERY_MS)
    await flush()
    expect(bus.requests.map((request) => request.kind)).toEqual([
      EPodCallKind.Follow,
      EPodCallKind.Renew,
    ])
    expect(closed).toEqual([])

    clock.advance(POD_STREAM_RENEW_EVERY_MS)
    await flush()
    expect(closed).toEqual(['restarted'])
    dispose?.()
  })

  it('releases the stream when the follower disposes it', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    const { router } = makeRouter({ plane, bus, hostId: 1 })

    const dispose = await router.follow({ sessionId: SESSION, listener: () => undefined })
    dispose?.()
    await flush()

    expect(bus.requests.map((request) => request.kind)).toEqual([
      EPodCallKind.Follow,
      EPodCallKind.Release,
    ])
    expect(bus.listening(streamIdOf(bus))).toBe(false)
  })

  it('never opens a stream when it is aborted while the subscription is pending', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    const controller = new AbortController()
    bus.deferSubscribe()
    const { router } = makeRouter({ plane, bus, hostId: 1 })

    const pending = router.follow({
      sessionId: SESSION,
      listener: () => undefined,
      signal: controller.signal,
    })
    await flush()
    controller.abort()
    bus.releaseSubscribe()

    expect(await pending).toBeNull()
    expect(bus.requests).toEqual([])
    expect(bus.subscribed).toHaveLength(1)
    expect(bus.listening(bus.subscribed[0] ?? '')).toBe(false)
  })

  it('returns null when the holder refuses the stream', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    bus.answer = () => ({ state: 'unavailable', reason: ELiveOpFailure.Asleep })
    const { router } = makeRouter({ plane, bus, hostId: 1 })

    expect(await router.follow({ sessionId: SESSION, listener: () => undefined })).toBeNull()
  })
})
