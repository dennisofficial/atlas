import { describe, expect, it } from 'bun:test'

import { EClientRequest, EServeFrame } from '@dltech/atlas-client/channel'

import { EPodConnectOutcome } from '../pod-connect'
import { event, flush, rig, ticketOf } from './live-thread-fixture'

const roster = { shells: [], agents: [], services: [] }

describe('local rewind preparation', () => {
  it('rejects a runtime read failure rather than returning a safe-looking empty roster', async () => {
    const test = rig({ seed: [event(1)], wake: async () => ticketOf('local') })
    test.controller.start()
    await flush()
    test.ready()
    await flush()
    test.answer({ index: 0, events: [event(1)] })
    await flush()
    const prepare = test.controller.prepareRewind
    if (!prepare) throw new Error('local preparation missing')
    const prepared = prepare()
    await flush()
    const rosterIndex = test
      .requests()
      .findIndex((request) => request.op === EClientRequest.ListRoster)
    test.reply({ index: rosterIndex, data: roster })
    await flush()
    const request = test.requests().at(-1)
    if (!request) throw new Error('runtime read missing')
    test.receive({
      kind: EServeFrame.Reply,
      replyTo: request.id,
      ok: false,
      data: { message: 'read failed' },
    })
    await expect(prepared).rejects.toThrow()
    expect(test.state().events).toEqual([event(1)])
    test.controller.stop()
  })

  it('rejects preparation when the attachment disconnects before the runtime read completes', async () => {
    const test = rig({ seed: [event(1)], wake: async () => ticketOf('local') })
    test.controller.start()
    await flush()
    test.ready()
    await flush()
    test.answer({ index: 0, events: [event(1)] })
    await flush()
    const prepare = test.controller.prepareRewind
    if (!prepare) throw new Error('local preparation missing')
    const prepared = prepare()
    await flush()
    const index = test.requests().findIndex((request) => request.op === EClientRequest.ListRoster)
    test.reply({ index, data: roster })
    await flush()
    test.socket().handlers.handleClose()
    await expect(prepared).rejects.toThrow()
    expect(test.state().channel).toBeNull()
    expect(test.sockets).toHaveLength(1)
    test.controller.stop()
  })

  it('wakes once for concurrent preparation and returns fresh full history and live working state', async () => {
    let wakes = 0
    let durable = [event(1), event(2), event(3)]
    const test = rig({
      seed: [event(1), event(2), event(3), event(4)],
      mints: [{ outcome: EPodConnectOutcome.NotRunning }],
      wake: async () => {
        wakes += 1
        return ticketOf('local')
      },
      readFreshSeed: async () => durable,
    })
    test.controller.start()
    await flush()
    const prepare = test.controller.prepareRewind
    if (!prepare) throw new Error('local preparation missing')
    const first = prepare()
    const second = prepare()
    await flush()
    expect(wakes).toBe(1)
    expect(test.state().channel).toBeNull()
    test.socket().handlers.handleOpen()
    test.receive({ kind: EServeFrame.Ready, seq: 0, turnInFlight: true })
    await flush()
    durable = [event(1), event(2, '{"fresh":true}')]
    const index = test.requests().findIndex((request) => request.op === EClientRequest.ListRoster)
    expect(index).toBeGreaterThanOrEqual(0)
    test.reply({ index, data: roster })
    await flush()
    const readIndex = test
      .requests()
      .findIndex((request) => request.op === EClientRequest.ReadEvents)
    expect(test.requests()[readIndex]?.params).toEqual({ threadId: 'thr_1', fromSeq: 0, own: true })
    test.answer({ index: readIndex, events: durable })
    const prepared = await first
    expect(await second).toEqual(prepared)
    expect(prepared.events).toEqual(durable)
    expect(prepared.working).toBe(true)
    expect(prepared.roster).toEqual(roster)
    expect(test.state().events).toEqual(durable)
    test.controller.stop()
  })
})
