import { describe, expect, it } from 'bun:test'

import { ELiveOpFailure, EPodCallKind, type CallOp } from '@dltech/atlas-protocol'

import { FakePodCallBus, fakePlaneOf } from './pod-route-fakes'
import { SESSION, STAT_OK, flush, makeRouter, runtimeOf } from './pod-router-rig'

const OP: CallOp = { op: 'stat', path: 'a.ts' }

const targets = (bus: FakePodCallBus): number[] =>
  bus.requests.map((request) => request.targetHostId)

describe('PodRouter.invoke', () => {
  it('answers from the local runtime without asking the bus', async () => {
    const plane = fakePlaneOf({ holderHostId: 1, wantsHolder: true })
    const bus = new FakePodCallBus()
    const runtime = runtimeOf({ invoke: async () => STAT_OK })
    const { router } = makeRouter({ plane, bus, runtime })

    const outcome = await router.invoke({ sessionId: SESSION, op: OP, waitForHolder: true })

    expect(outcome.state).toBe('ok')
    expect(bus.requests).toEqual([])
  })

  it('answers asleep for the old call shape when this host holds nothing', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    const { router } = makeRouter({ plane, bus })

    expect(await router.invoke({ sessionId: SESSION, op: OP })).toEqual({
      state: 'unavailable',
      reason: ELiveOpFailure.Asleep,
    })
    expect(bus.requests).toEqual([])
  })

  it('forwards the op to the holder host and returns its result', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    bus.answer = () => ({ state: 'ok', result: STAT_OK })
    const { router } = makeRouter({ plane, bus, hostId: 1 })

    const outcome = await router.invoke({ sessionId: SESSION, op: OP, waitForHolder: true })

    expect(outcome.state).toBe('ok')
    expect(outcome).toMatchObject({ state: 'ok', result: STAT_OK })
    expect(bus.requests).toHaveLength(1)
    expect(bus.requests[0]).toMatchObject({
      kind: EPodCallKind.Invoke,
      sessionId: SESSION,
      targetHostId: 7,
      replyTo: bus.requesterId,
      op: OP,
    })
  })

  it('reaches once more and retries when the holder answered unavailable', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    bus.answer = () =>
      bus.requests.length === 1
        ? { state: 'unavailable', reason: ELiveOpFailure.Asleep }
        : { state: 'ok', result: STAT_OK }
    const { router } = makeRouter({ plane, bus, hostId: 1 })

    const outcome = await router.invoke({ sessionId: SESSION, op: OP, waitForHolder: true })

    expect(outcome.state).toBe('ok')
    expect(outcome).toMatchObject({ state: 'ok', result: STAT_OK })
    expect(bus.requests).toHaveLength(2)
    expect(plane.calls.reads).toBe(2)
  })

  it('waits for the next ready when the draining holder gave the lease back', async () => {
    const bus = new FakePodCallBus()
    const plane = fakePlaneOf(
      { holderHostId: 7, wantsHolder: true },
      {
        reads: [
          { holderHostId: 7, wantsHolder: true, live: true },
          { holderHostId: null, wantsHolder: true },
          { holderHostId: null, wantsHolder: true },
          { holderHostId: null, wantsHolder: true },
        ],
      },
    )
    bus.answer = () =>
      bus.requests.length === 1
        ? { state: 'unavailable', reason: ELiveOpFailure.Asleep }
        : { state: 'ok', result: STAT_OK }
    const { router } = makeRouter({ plane, bus, hostId: 1, holderWaitMs: 10_000 })
    const pending = router.invoke({ sessionId: SESSION, op: OP, waitForHolder: true })

    await flush()
    bus.emitReady({ sessionId: SESSION, hostId: 8 })

    expect(await pending).toMatchObject({ state: 'ok', result: STAT_OK })
    expect(targets(bus)).toEqual([7, 8])
  })

  it('reaches again when the forwarded call timed out and asks the new holder', async () => {
    const bus = new FakePodCallBus()
    const plane = fakePlaneOf(
      { holderHostId: 7, wantsHolder: true },
      {
        reads: [
          { holderHostId: 7, wantsHolder: true, live: true },
          { holderHostId: 8, wantsHolder: true, live: true },
        ],
      },
    )
    let calls = 0
    bus.answer = () => {
      calls += 1
      if (calls === 1) throw new Error('invoke timed out after 15000ms')
      return { state: 'ok', result: STAT_OK }
    }
    const { router } = makeRouter({ plane, bus, hostId: 1 })

    const outcome = await router.invoke({ sessionId: SESSION, op: OP, waitForHolder: true })

    expect(outcome).toMatchObject({ state: 'ok', result: STAT_OK })
    expect(targets(bus)).toEqual([7, 8])
  })

  it('returns unavailable when the retry is unavailable too', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    bus.answer = () => ({ state: 'unavailable', reason: ELiveOpFailure.Asleep })
    const { router } = makeRouter({ plane, bus, hostId: 1 })

    expect(await router.invoke({ sessionId: SESSION, op: OP, waitForHolder: true })).toEqual({
      state: 'unavailable',
      reason: ELiveOpFailure.Asleep,
    })
    expect(bus.requests).toHaveLength(2)
  })

  it('raises the failure the holder reported', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const bus = new FakePodCallBus()
    bus.answer = () => ({ state: 'failed', message: 'the file is gone' })
    const { router } = makeRouter({ plane, bus, hostId: 1 })

    await expect(
      router.invoke({ sessionId: SESSION, op: OP, waitForHolder: true }),
    ).rejects.toThrow('the file is gone')
    expect(bus.requests).toHaveLength(1)
  })

  it('answers asleep when no bus is wired and another host holds the session', async () => {
    const plane = fakePlaneOf({ holderHostId: 7, wantsHolder: true })
    const { router } = makeRouter({ plane, hostId: 1 })

    expect(await router.invoke({ sessionId: SESSION, op: OP, waitForHolder: true })).toEqual({
      state: 'unavailable',
      reason: ELiveOpFailure.Asleep,
    })
  })
})
