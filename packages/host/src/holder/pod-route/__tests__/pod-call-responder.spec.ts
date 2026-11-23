import { describe, expect, it } from 'bun:test'

import { ELiveOpFailure, EPodCallFailure, type PodStreamFrame } from '@dltech/atlas-protocol'

import { FencedError } from '../../../calls/errors'
import {
  SESSION,
  STREAM,
  TTL,
  followRequest,
  invokeRequest,
  makeResponder,
  releaseRequest,
  renewRequest,
  runtimeOf,
  STAT_OK,
  HOST,
  flush,
} from './pod-responder-rig'

describe('PodCallResponder', () => {
  it('ignores a request addressed to another host', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.bus.emitRequest({ ...invokeRequest(), targetHostId: HOST + 1 })
    await flush()

    expect(rig.bus.replies).toEqual([])
  })

  it('serves an invoke from the runtime it holds', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.bus.emitRequest(invokeRequest())
    await flush()

    expect(rig.bus.replies).toEqual([
      { requestId: 'req-1', outcome: { state: 'ok', result: STAT_OK } },
    ])
  })

  it('answers asleep when this host holds nothing for the session', async () => {
    const rig = makeResponder({})
    rig.bus.emitRequest(invokeRequest())
    await flush()

    expect(rig.bus.replies).toEqual([
      {
        requestId: 'req-1',
        outcome: { state: 'unavailable', reason: ELiveOpFailure.Asleep },
      },
    ])
  })

  it('waits for the runtime to open before it invokes', async () => {
    const rig = makeResponder({ holds: true })
    rig.bus.emitRequest(invokeRequest())
    await flush()
    expect(rig.bus.replies).toEqual([])

    rig.state.runtime = runtimeOf({ invoke: async () => STAT_OK })
    rig.demand.notifyHeld(SESSION)
    await flush()

    expect(rig.bus.replies).toEqual([
      { requestId: 'req-1', outcome: { state: 'ok', result: STAT_OK } },
    ])
  })

  it('reports the message of a call that failed', async () => {
    const rig = makeResponder({
      runtime: runtimeOf({
        invoke: async () => {
          throw new Error('the sandbox refused the path')
        },
      }),
    })
    rig.bus.emitRequest(invokeRequest())
    await flush()

    expect(rig.bus.replies).toEqual([
      { requestId: 'req-1', outcome: { state: 'failed', message: 'the sandbox refused the path' } },
    ])
  })

  it('opens a stream, publishes its frames and holds the terminal demand', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.bus.emitRequest(followRequest())
    await flush()

    expect(rig.bus.replies).toEqual([{ requestId: 'req-1', outcome: { state: 'open' } }])
    expect(rig.demand.terminal.countOf(SESSION)).toBe(1)

    rig.bus.emitRequest({ ...releaseRequest(), requestId: 'req-2' })
    await flush()
    expect(rig.bus.replies[1]).toEqual({ requestId: 'req-2', outcome: { state: 'open' } })
    expect(rig.demand.terminal.countOf(SESSION)).toBe(0)
  })

  it('releases the terminal demand when the stream expires', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.bus.emitRequest(followRequest())
    await flush()
    expect(rig.demand.terminal.countOf(SESSION)).toBe(1)

    rig.clock.advance(TTL)
    await flush()

    expect(rig.demand.terminal.countOf(SESSION)).toBe(0)
    rig.bus.emitRequest({ ...renewRequest(), requestId: 'req-2' })
    await flush()
    expect(rig.bus.replies[1]).toEqual({
      requestId: 'req-2',
      outcome: { state: 'unavailable', reason: ELiveOpFailure.Absent },
    })
  })

  it('renews a live stream and refuses an unknown one', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.bus.emitRequest(followRequest())
    await flush()

    rig.clock.advance(TTL / 2)
    rig.bus.emitRequest({ ...renewRequest(), requestId: 'req-2' })
    await flush()
    expect(rig.bus.replies[1]).toEqual({ requestId: 'req-2', outcome: { state: 'open' } })

    rig.clock.advance(TTL - 1)
    await flush()
    expect(rig.demand.terminal.countOf(SESSION)).toBe(1)
  })

  it('answers asleep for a follow when this host holds nothing', async () => {
    const rig = makeResponder({})
    rig.bus.emitRequest(followRequest())
    await flush()

    expect(rig.bus.replies).toEqual([
      {
        requestId: 'req-1',
        outcome: { state: 'unavailable', reason: ELiveOpFailure.Asleep },
      },
    ])
    expect(rig.demand.terminal.countOf(SESSION)).toBe(0)
  })

  it('closes every stream with restarted on stop and then ignores requests', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.bus.emitRequest(followRequest())
    await flush()

    rig.responder.stop()
    await flush()

    const frames = rig.bus.published.map((published) => published.frame)
    expect(frames).toContainEqual({ type: 'closed', reason: 'restarted' } satisfies PodStreamFrame)
    expect(rig.demand.terminal.countOf(SESSION)).toBe(0)
    expect(rig.bus.listening(STREAM)).toBe(false)

    rig.bus.emitRequest({ ...invokeRequest(), requestId: 'req-9' })
    await flush()
    expect(rig.bus.replies).toHaveLength(1)
  })

  it('holds the session while it serves a forwarded invoke', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.bus.emitRequest(invokeRequest())
    await flush()

    expect(rig.demand.panel.holds(SESSION)).toBe(true)
  })

  it('marks a fenced failure so the router can retry', async () => {
    const rig = makeResponder({
      runtime: runtimeOf({
        invoke: async () => {
          throw new FencedError('session ses_respond closed its daemon link')
        },
      }),
    })
    rig.bus.emitRequest(invokeRequest())
    await flush()

    expect(rig.bus.replies).toEqual([
      {
        requestId: 'req-1',
        outcome: {
          state: 'failed',
          message: 'session ses_respond closed its daemon link',
          reason: EPodCallFailure.Fenced,
        },
      },
    ])
  })
})
