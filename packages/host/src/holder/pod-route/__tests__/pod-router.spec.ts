import { describe, expect, it } from 'bun:test'

import { FakeClock } from '../../__tests__/rig-fakes'
import { EPodReach } from '../pod-reach'
import { FakePodCallBus, fakePlaneOf } from './pod-route-fakes'
import { SESSION, STAT_OK, flush, makeRouter, runtimeOf } from './pod-router-rig'

describe('PodRouter.reach', () => {
  it('serves the call here when the runtime is open', async () => {
    const plane = fakePlaneOf({ holderHostId: 1, wantsHolder: true })
    const runtime = runtimeOf({ invoke: async () => STAT_OK })
    const { router } = makeRouter({ plane, runtime })

    expect(await router.reach({ sessionId: SESSION })).toEqual({ kind: EPodReach.Local })
  })

  it('forwards to the host that holds the lease', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const { router } = makeRouter({ plane, hostId: 1 })

    expect(await router.reach({ sessionId: SESSION })).toEqual({
      kind: EPodReach.Remote,
      hostId: 7,
    })
  })

  it('waits for the local runtime when this host holds the session', async () => {
    const plane = fakePlaneOf({ holderHostId: 1, wantsHolder: true })
    const clock = new FakeClock()
    const { router } = makeRouter({ plane, holds: true, clock, holderWaitMs: 1_000 })
    let settled = false
    const pending = router.reach({ sessionId: SESSION }).then((reach) => {
      settled = true
      return reach
    })

    await flush()
    expect(settled).toBe(false)
    clock.advance(1_000)
    expect(await pending).toEqual({ kind: EPodReach.Unreachable })
  })

  it('wakes a wanted session and reports the host that made it ready', async () => {
    const plane = fakePlaneOf({ holderHostId: null, wantsHolder: true })
    const bus = new FakePodCallBus()
    const { router } = makeRouter({ plane, bus, hostId: 1, holderWaitMs: 10_000 })
    const pending = router.reach({ sessionId: SESSION })

    await flush()
    expect(plane.calls.wakes).toEqual([{ sessionIds: [SESSION] }])
    bus.emitReady({ sessionId: SESSION, hostId: 9 })

    expect(await pending).toEqual({ kind: EPodReach.Remote, hostId: 9 })
  })

  it('catches a ready signal that arrives while the wake is in flight', async () => {
    const bus = new FakePodCallBus()
    const plane = fakePlaneOf(
      { holderHostId: null, wantsHolder: true },
      { onWake: () => bus.emitReady({ sessionId: SESSION, hostId: 9 }) },
    )
    const { router } = makeRouter({ plane, bus, hostId: 1, holderWaitMs: 10_000 })

    expect(await router.reach({ sessionId: SESSION })).toEqual({
      kind: EPodReach.Remote,
      hostId: 9,
    })
  })

  it('forwards to the host that claimed the session while the wake was in flight', async () => {
    const plane = fakePlaneOf(
      { holderHostId: null, wantsHolder: true },
      {
        reads: [
          { holderHostId: null, wantsHolder: true },
          { holderHostId: 7, wantsHolder: true, live: true },
          { holderHostId: 7, wantsHolder: true, live: true },
        ],
      },
    )
    const { router } = makeRouter({ plane, hostId: 1, holderWaitMs: 10_000 })

    expect(await router.reach({ sessionId: SESSION })).toEqual({
      kind: EPodReach.Remote,
      hostId: 7,
    })
  })

  it('revokes a session nobody holds and reports the local host when it becomes ready', async () => {
    const plane = fakePlaneOf({ holderHostId: null, wantsHolder: false })
    const clock = new FakeClock()
    const { router, demand } = makeRouter({ plane, hostId: 1, clock, holderWaitMs: 10_000 })
    const pending = router.reach({ sessionId: SESSION })

    await flush()
    expect(plane.calls.revokes).toEqual([{ sessionId: SESSION, wantsHolder: true }])
    demand.notifyHeld(SESSION)

    expect(await pending).toEqual({ kind: EPodReach.Local })
  })

  it('requests another holder when the lease emptied between the request and the re-read', async () => {
    const bus = new FakePodCallBus()
    const plane = fakePlaneOf(
      { holderHostId: null, wantsHolder: true },
      {
        reads: [
          { holderHostId: null, wantsHolder: true },
          { holderHostId: 7, wantsHolder: true, live: true },
          { holderHostId: null, wantsHolder: true },
          { holderHostId: null, wantsHolder: true },
        ],
      },
    )
    const { router } = makeRouter({ plane, bus, hostId: 1, holderWaitMs: 10_000 })
    const pending = router.reach({ sessionId: SESSION })

    await flush()
    expect(plane.calls.wakes).toEqual([{ sessionIds: [SESSION] }])
    bus.emitReady({ sessionId: SESSION, hostId: 9 })

    expect(await pending).toEqual({ kind: EPodReach.Remote, hostId: 9 })
  })

  it('waits for the local runtime when it is named the holder but holds nothing', async () => {
    const plane = fakePlaneOf(
      { holderHostId: null, wantsHolder: true },
      {
        reads: [
          { holderHostId: null, wantsHolder: true },
          { holderHostId: 1, wantsHolder: true, live: true },
          { holderHostId: 1, wantsHolder: true, live: true },
        ],
      },
    )
    const { router, demand } = makeRouter({
      plane,
      hostId: 1,
      holderWaitMs: 10_000,
    })
    const pending = router.reach({ sessionId: SESSION })

    await flush()
    demand.notifyHeld(SESSION)

    expect(await pending).toEqual({ kind: EPodReach.Local })
  })

  it('is unreachable when the holder wait elapses', async () => {
    const plane = fakePlaneOf({ holderHostId: null, wantsHolder: true })
    const clock = new FakeClock()
    const { router } = makeRouter({ plane, clock, holderWaitMs: 5_000 })
    const pending = router.reach({ sessionId: SESSION })

    await flush()
    clock.advance(5_000)

    expect(await pending).toEqual({ kind: EPodReach.Unreachable })
  })

  it('never wakes or revokes while this host drains', async () => {
    const plane = fakePlaneOf({ holderHostId: null, wantsHolder: false })
    const { router } = makeRouter({ plane, draining: true })

    expect(await router.reach({ sessionId: SESSION })).toEqual({ kind: EPodReach.Unreachable })
    expect(plane.calls.wakes).toEqual([])
    expect(plane.calls.revokes).toEqual([])
  })
})
