import { describe, expect, it } from 'bun:test'

import { EClientRequest, EServeFrame } from '@dltech/atlas-client/channel'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { EPodConnectOutcome } from '../pod-connect'
import { event, flush, rig, ticketOf } from './live-thread-fixture'

describe('local durable catchup', () => {
  it('does not let an unfinished host read overwrite the runtime reload snapshot', async () => {
    let finishHostRead: (events: WireEvent[]) => void = () => undefined
    const test = rig({
      mints: [{ outcome: EPodConnectOutcome.NotRunning }],
      wake: async () => ticketOf('local'),
      readFreshSeed: () =>
        new Promise((resolve) => {
          finishHostRead = resolve
        }),
    })
    test.controller.start()
    await flush()
    test.controller.send({ text: 'wake', requestId: 'req_wake' })
    await flush()
    test.ready()
    await flush()
    test.receive({ kind: EServeFrame.Reload, sinceEventSeq: 1 })
    await flush()
    const current = [event(1, '{"current":true}')]
    test.answer({ index: 0, events: current })
    await flush()
    expect(test.state().events).toEqual(current)
    finishHostRead([event(1), event(2), event(3)])
    await flush()
    expect(test.state().events).toEqual(current)
    test.controller.stop()
  })

  it('reconciles reload from the current runtime even when the host mirror still has the old suffix', async () => {
    const stale = [event(1), event(2), event(3), event(4)]
    let freshHostReads = 0
    const test = rig({
      seed: stale,
      wake: async () => ticketOf('local'),
      readFreshSeed: async () => {
        freshHostReads += 1
        return stale
      },
    })
    test.controller.start()
    await flush()
    test.ready()
    await flush()
    test.answer({ index: 0, events: [event(4)] })
    await flush()
    test.receive({ kind: EServeFrame.Reload, sinceEventSeq: 1 })
    await flush()
    expect(test.requests()[1]?.params).toEqual({ threadId: 'thr_1', fromSeq: 0, own: true })
    expect(test.state().events).toEqual([event(1)])
    const current = [event(1), event(2, '{"rewritten":true}')]
    test.answer({ index: 1, events: current })
    await flush()
    expect(test.state().events).toEqual(current)
    expect(freshHostReads).toBe(0)
    test.controller.stop()
  })

  it('reads one full host seed on cold Running open and catches up with an anchored runtime delta', async () => {
    let fullReads = 0
    const test = rig({
      readSeed: async () => {
        fullReads += 1
        return [event(1), event(2)]
      },
      readFreshSeed: async () => {
        fullReads += 1
        return [event(1), event(2), event(3)]
      },
      wake: async () => ticketOf('local'),
    })
    test.controller.start()
    await flush()
    test.ready()
    await flush()
    expect(fullReads).toBe(1)
    expect(test.requests()).toHaveLength(1)
    expect(test.requests()[0]?.op).toBe(EClientRequest.ReadEvents)
    expect(test.requests()[0]?.params).toEqual({ threadId: 'thr_1', fromSeq: 2, own: true })
    test.answer({ index: 0, events: [event(2), event(3)] })
    await flush()
    expect(test.state().events.map((entry) => entry.seq)).toEqual([1, 2, 3])
    expect(fullReads).toBe(1)
    test.controller.stop()
  })

  it('resets a deferred-first attachment from host history and uses runtime history for reload', async () => {
    let durable = [event(1), event(2, '{"new":true}')]
    let freshReads = 0
    const test = rig({
      seed: [event(1), event(2), event(3), event(4)],
      mints: [{ outcome: EPodConnectOutcome.NotRunning }],
      wake: async () => ticketOf('local'),
      readFreshSeed: async () => {
        freshReads += 1
        return durable
      },
    })
    test.controller.start()
    await flush()
    test.controller.send({ text: 'wake', requestId: 'req_wake' })
    await flush()
    test.ready()
    await flush()
    expect(test.state().events).toEqual(durable)
    expect(freshReads).toBe(1)
    expect(test.requests()).toEqual([])

    durable = [event(1, '{"rewritten":true}')]
    test.receive({ kind: EServeFrame.Reload, sinceEventSeq: 1 })
    await flush()
    expect(test.requests()[0]?.params).toEqual({ threadId: 'thr_1', fromSeq: 0, own: true })
    test.answer({ index: 0, events: durable })
    await flush()
    expect(test.state().events).toEqual(durable)
    expect(freshReads).toBe(1)
    test.socket().handlers.handleClose()
    test.receive({ kind: EServeFrame.Reload, sinceEventSeq: 0 })
    test.receive({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'events-appended' } })
    await flush()
    expect(freshReads).toBe(1)
    expect(test.requests()).toHaveLength(1)
    test.controller.stop()
  })
})
