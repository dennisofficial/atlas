import { describe, expect, it } from 'bun:test'

import { ELiveOpFailure, LIVE_OP_TIMEOUT_MS, type PodStreamFrame } from '@dltech/atlas-protocol'

import {
  SESSION,
  STAT_OK,
  flush,
  followRequest,
  invokeRequest,
  makeResponder,
  renewRequest,
  runtimeOf,
} from './pod-responder-rig'

const countingRuntime = (runs: { count: number }) =>
  runtimeOf({
    invoke: async () => {
      runs.count += 1
      return STAT_OK
    },
  })

describe('PodCallResponder duplicate delivery', () => {
  it('runs a request delivered twice once', async () => {
    const runs = { count: 0 }
    const rig = makeResponder({ runtime: countingRuntime(runs) })
    const request = invokeRequest()
    rig.bus.emitRequest(request)
    rig.bus.emitRequest(request)
    await flush()

    expect(runs.count).toBe(1)
    expect(rig.bus.replies).toEqual([
      { requestId: 'req-1', outcome: { state: 'ok', result: STAT_OK } },
    ])
  })

  it('serves the same request id again once the duplicate window has passed', async () => {
    const runs = { count: 0 }
    const rig = makeResponder({ runtime: countingRuntime(runs) })
    const request = invokeRequest()
    rig.bus.emitRequest(request)
    await flush()

    rig.clock.advance(LIVE_OP_TIMEOUT_MS * 2)
    rig.bus.emitRequest(request)
    await flush()

    expect(runs.count).toBe(2)
  })
})

describe('PodCallResponder draining', () => {
  it('answers a call that arrives while it drains as asleep and keeps listening', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.responder.beginDrain()

    rig.bus.emitRequest(invokeRequest())
    await flush()

    expect(rig.bus.replies).toEqual([
      {
        requestId: 'req-1',
        outcome: { state: 'unavailable', reason: ELiveOpFailure.Asleep },
      },
    ])
  })

  it('closes its streams when it begins to drain', async () => {
    const rig = makeResponder({ runtime: runtimeOf({ invoke: async () => STAT_OK }) })
    rig.bus.emitRequest(followRequest())
    await flush()

    rig.responder.beginDrain()
    await flush()

    const frames = rig.bus.published.map((published) => published.frame)
    expect(frames).toContainEqual({ type: 'closed', reason: 'restarted' } satisfies PodStreamFrame)
    expect(rig.demand.terminal.countOf(SESSION)).toBe(0)

    rig.bus.emitRequest({ ...renewRequest(), requestId: 'req-2' })
    await flush()
    expect(rig.bus.replies[1]).toEqual({
      requestId: 'req-2',
      outcome: { state: 'unavailable', reason: ELiveOpFailure.Asleep },
    })
  })
})
