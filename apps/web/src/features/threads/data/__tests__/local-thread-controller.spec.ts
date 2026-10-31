import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-client/channel'

import { EPodConnectOutcome, type PodConnectResult } from '../pod-connect'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { event, flush, rig, ticketOf } from './live-thread-fixture'

const parked = { outcome: EPodConnectOutcome.NotRunning } as const

describe('retained local action channel', () => {
  it('keeps parallel startup recoverable when the seed fails and passive mint succeeds', async () => {
    let failSeed: (reason: Error) => void = () => undefined
    let wakes = 0
    const test = rig({
      readSeed: () =>
        new Promise((_, reject) => {
          failSeed = reject
        }),
      wake: async () => {
        wakes += 1
        return ticketOf('recovered')
      },
      readFreshSeed: async () => [event(1)],
    })
    test.controller.start()
    await flush()
    expect(test.mintCount()).toBe(1)
    expect(test.sockets).toHaveLength(0)
    failSeed(new Error('history unavailable'))
    await flush()
    expect(test.state().live).toBe(false)
    expect(test.state().channel).toBeNull()
    expect(wakes).toBe(0)

    const chosen = test.controller.chooseModel({ ref: 'a/b', effort: 'low' })
    await flush()
    expect(wakes).toBe(1)
    test.ready()
    await flush()
    const index = test
      .requests()
      .findIndex((request) => request.op === EClientRequest.SetThreadModel)
    test.reply({ index, data: {} })
    expect(await chosen).toBe(true)
    expect(test.state().events).toEqual([event(1)])
    test.controller.stop()
  })

  it('retains seed history after a passive mint failure and recovers on one explicit action wake', async () => {
    let wakes = 0
    const test = rig({
      mints: [],
      wake: async () => {
        wakes += 1
        return ticketOf('recovered')
      },
      readFreshSeed: async () => [event(1), event(2)],
    })
    test.controller.start()
    await flush()
    expect(test.state().events).toEqual([event(1), event(2)])
    expect(test.state().channel).toBeNull()
    expect(test.sockets).toHaveLength(0)
    expect(wakes).toBe(0)
    expect(test.mintCount()).toBe(1)

    expect(test.controller.send({ text: 'recover', requestId: 'req_recover' })).toBe(true)
    const chosen = test.controller.chooseModel({ ref: 'a/b', effort: 'low' })
    await flush()
    expect(wakes).toBe(1)
    test.ready()
    await flush()
    const index = test
      .requests()
      .findIndex((request) => request.op === EClientRequest.SetThreadModel)
    test.reply({ index, data: {} })
    expect(await chosen).toBe(true)
    expect(test.state().live).toBe(true)
    expect(test.socket().sent.filter((frame) => frame.kind === EClientFrame.Send)).toHaveLength(1)
    test.controller.stop()
  })

  it('never attaches a wake completed after stop and rejects the queued mutation', async () => {
    let finishWake: (result: PodConnectResult) => void = () => undefined
    const test = rig({
      mints: [parked],
      wake: () =>
        new Promise((resolve) => {
          finishWake = resolve
        }),
    })
    test.controller.start()
    await flush()
    const chosen = test.controller.chooseModel({ ref: 'a/b', effort: 'low' })
    test.controller.stop()
    await expect(chosen).rejects.toThrow('closed')
    finishWake(ticketOf('late'))
    await flush()
    expect(test.sockets).toHaveLength(0)
    expect(test.state().channel).toBeNull()
  })

  it('refreshes a new attachment even while the previous attachment history read is unfinished', async () => {
    let finishOldRead: (events: WireEvent[]) => void = () => undefined
    let reads = 0
    const test = rig({
      mints: [parked],
      wake: async () => ticketOf('next'),
      readFreshSeed: () => {
        reads += 1
        if (reads === 1)
          return new Promise((resolve) => {
            finishOldRead = resolve
          })
        return Promise.resolve([event(1, '{"new":true}')])
      },
    })
    test.controller.start()
    await flush()
    test.controller.send({ text: 'wake', requestId: 'req_wake' })
    await flush()
    test.ready()
    await flush()
    test.socket().handlers.handleClose()
    test.controller.send({ text: 'again', requestId: 'req_again' })
    await flush()
    test.ready()
    await flush()
    expect(reads).toBe(2)
    expect(test.state().events).toEqual([event(1, '{"new":true}')])
    finishOldRead([event(1), event(2), event(3)])
    await flush()
    expect(test.state().events).toEqual([event(1, '{"new":true}')])
    test.controller.stop()
  })

  it('rejects wake failure, permits a later action retry, and closes queued work on stop', async () => {
    let wakes = 0
    const test = rig({
      mints: [parked],
      wake: async () => {
        wakes += 1
        if (wakes === 1) throw new Error('host unavailable')
        return ticketOf('retry')
      },
    })
    test.controller.start()
    await flush()
    await expect(test.controller.readRoster()).rejects.toThrow('host unavailable')
    expect(test.state().live).toBe(false)
    expect(test.state().channel).toBeNull()
    expect(test.state().events.map((event) => event.seq)).toEqual([1, 2])
    expect(wakes).toBe(1)
    expect(test.sockets).toHaveLength(0)

    const taken = test.controller.takeBackPending()
    await flush()
    expect(wakes).toBe(2)
    test.controller.stop()
    await expect(taken).rejects.toThrow()
    expect(test.socket().closed).toBe(true)
    expect(test.controller.send({ text: 'after stop', requestId: 'req_stop' })).toBe(false)
    await expect(test.controller.readRoster()).rejects.toThrow('not connected')
    expect(wakes).toBe(2)
  })

  it('ignores stale pod titles while retaining host-backed local title authority', async () => {
    const test = rig({ wake: async () => ticketOf('local') })
    test.controller.start()
    await flush()
    test.ready()
    test.receive({ kind: EServeFrame.ThreadRenamed, threadId: 'thr_1', title: 'stale pod title' })
    expect(test.state().liveTitle).toBeNull()
    test.controller.stop()
  })

  it('rejects panel reads through captured channels after disconnect or park without waking', async () => {
    let wakes = 0
    const test = rig({
      wake: async () => {
        wakes += 1
        return ticketOf('local')
      },
    })
    test.controller.start()
    await flush()
    test.ready()
    const captured = test.state().channel
    expect(captured).not.toBeNull()
    test.socket().handlers.handleClose()
    await flush()
    expect(test.state().channel).toBeNull()
    await expect(captured?.request({ op: EClientRequest.ListFiles, params: {} })).rejects.toThrow()
    test.receive({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'events-appended' } })
    await flush()
    expect(wakes).toBe(0)
    expect(test.sockets).toHaveLength(1)

    expect(test.controller.send({ text: 'wake', requestId: 'req_2' })).toBe(true)
    await flush()
    test.ready()
    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    expect(test.state().channel).toBeNull()
    await expect(captured?.request({ op: EClientRequest.ListFiles, params: {} })).rejects.toThrow()
    await flush()
    expect(wakes).toBe(1)
    test.controller.stop()
  })

  it('retains parked history and shares one wake for send and model choice', async () => {
    let wakes = 0
    const test = rig({
      mints: [parked],
      wake: async () => {
        wakes += 1
        return ticketOf('local')
      },
    })
    test.controller.start()
    await flush()
    expect(test.state().events.map((event) => event.seq)).toEqual([1, 2])
    expect(test.state().channel).toBeNull()
    expect(test.sockets).toHaveLength(0)
    expect(wakes).toBe(0)

    expect(test.controller.send({ text: 'continue', requestId: 'req_1' })).toBe(true)
    const choice = test.controller.chooseModel({ ref: 'a/b', effort: 'high' })
    await flush()
    expect(wakes).toBe(1)
    test.ready()
    await flush()
    expect(test.socket().sent.filter((frame) => frame.kind === EClientFrame.Send)).toHaveLength(1)
    const index = test
      .requests()
      .findIndex((request) => request.op === EClientRequest.SetThreadModel)
    expect(index).toBeGreaterThanOrEqual(0)
    test.reply({ index, data: {} })
    expect(await choice).toBe(true)
    test.controller.stop()
  })
})
