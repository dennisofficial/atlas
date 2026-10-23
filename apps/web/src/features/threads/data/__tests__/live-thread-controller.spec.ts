import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-client/channel'

import { MAX_REMINTS, remintDelayMs } from '../live-thread-controller'
import { EPodConnectOutcome } from '../pod-connect'
import { event, flush, rig, ticketOf } from './live-thread-fixture'

describe('createLiveThreadController', () => {
  it('connects with the minted ticket, seeds the durable events, and goes live on ready', async () => {
    const test = rig()
    test.controller.start()
    await flush()

    expect(test.socket().url).toBe('wss://pod.test/v1/session')
    expect(test.socket().protocols).toEqual(['atlas.v1', 'bearer.tkt1'])
    expect(test.state().live).toBe(false)

    test.ready()
    expect(test.state().live).toBe(true)
    expect(test.state().events.map((entry) => entry.seq)).toEqual([1, 2])
  })

  it('reads past the head over the channel on events-appended and dedupes by seq', async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()
    await flush()
    const before = test.requests().length

    test.receive({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'events-appended' } })
    await flush()

    const request = test.requests()[before]
    expect(request?.op).toBe(EClientRequest.ReadEvents)
    expect(request?.params).toEqual({ threadId: 'thr_1', fromSeq: 2, own: true })

    test.answer({ index: before, events: [event(2), event(3), event(4)] })
    await flush()
    expect(test.state().events.map((entry) => entry.seq)).toEqual([1, 2, 3, 4])
  })

  it('on reload drops events past sinceEventSeq and re-reads from there', async () => {
    const test = rig({ seed: [event(1), event(2), event(3)] })
    test.controller.start()
    await flush()
    test.ready()
    await flush()
    const before = test.requests().length

    test.receive({ kind: EServeFrame.Reload, sinceEventSeq: 1 })
    await flush()

    expect(test.state().events.map((entry) => entry.seq)).toEqual([1])
    expect(test.requests()[before]?.params).toEqual({ threadId: 'thr_1', fromSeq: 1, own: true })
    test.answer({ index: before, events: [event(2, '{"fresh":true}')] })
    await flush()
    expect(test.state().events.map((entry) => entry.body)).toEqual(['{}', '{"fresh":true}'])
  })

  it('tracks working from turn-working signals', async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()

    test.receive({
      kind: EServeFrame.Signal,
      seq: 1,
      signal: { type: 'turn-working', working: true },
    })
    expect(test.state().working).toBe(true)
    test.receive({
      kind: EServeFrame.Signal,
      seq: 2,
      signal: { type: 'turn-working', working: false },
    })
    expect(test.state().working).toBe(false)
  })

  it('re-mints a fresh ticket when the socket drops and redials with it', async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()
    expect(test.mintCount()).toBe(1)

    test.socket().handlers.handleClose()
    await flush()

    expect(test.mintCount()).toBe(2)
    expect(test.sockets).toHaveLength(2)
    expect(test.socket().protocols).toEqual(['atlas.v1', 'bearer.tkt2'])
    expect(test.retries).toHaveLength(0)
  })

  it('stops re-minting and falls back once reconnects keep failing', async () => {
    const mints = Array.from({ length: 8 }, (_, index) => ticketOf(`tkt${index}`))
    const test = rig({ mints })
    test.controller.start()
    await flush()
    test.ready()

    for (let round = 0; round < 8; round += 1) {
      test.socket().handlers.handleClose()
      await flush()
    }

    expect(test.state().live).toBe(false)
    expect(test.mintCount()).toBe(1 + MAX_REMINTS)
  })

  it('falls back when the re-mint answers pod-not-running', async () => {
    const test = rig({
      mints: [ticketOf('tkt1'), { outcome: EPodConnectOutcome.NotRunning }],
    })
    test.controller.start()
    await flush()
    test.ready()

    test.socket().handlers.handleClose()
    await flush()

    expect(test.state().live).toBe(false)
    expect(test.sockets).toHaveLength(1)
    expect(test.socket().closed).toBe(true)
  })

  it('falls back when the pod parks', async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()
    expect(test.state().live).toBe(true)

    test.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    await flush()

    expect(test.state().live).toBe(false)
    expect(test.socket().closed).toBe(true)
  })

  it('never opens a socket when the first mint answers pod-not-running', async () => {
    const test = rig({ mints: [{ outcome: EPodConnectOutcome.NotRunning }] })
    test.controller.start()
    await flush()

    expect(test.sockets).toHaveLength(0)
    expect(test.state().live).toBe(false)
  })

  it('falls back at once when the upgrade is refused before the first ready', async () => {
    const test = rig()
    test.controller.start()
    await flush()

    test.socket().handlers.handleError('refused')
    test.socket().handlers.handleClose()
    await flush()

    expect(test.state().live).toBe(false)
    expect(test.socket().closed).toBe(true)
    expect(test.mintCount()).toBe(1)
  })

  it('falls back when the first mint fails outright', async () => {
    const test = rig({ mints: [] })
    test.controller.start()
    await flush()

    expect(test.sockets).toHaveLength(0)
    expect(test.state().live).toBe(false)
  })

  it('sends over the socket with the requestId only while connected', async () => {
    const test = rig()
    expect(test.controller.send({ text: 'early', requestId: 'r0' })).toBe(false)
    test.controller.start()
    await flush()
    expect(test.controller.send({ text: 'early', requestId: 'r0' })).toBe(false)
    test.ready()

    expect(test.controller.send({ text: 'hello', requestId: 'r1' })).toBe(true)

    const sends = test.socket().sent.filter((frame) => frame.kind === EClientFrame.Send)
    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({ text: 'hello', requestId: 'r1' })
  })

  it('closes the socket and goes quiet on stop', async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()

    test.controller.stop()
    const emitted = test.history.length
    test.receive({
      kind: EServeFrame.Signal,
      seq: 1,
      signal: { type: 'turn-working', working: true },
    })

    expect(test.socket().closed).toBe(true)
    expect(test.history).toHaveLength(emitted)
    expect(test.controller.send({ text: 'x', requestId: 'r' })).toBe(false)
  })

  it('chooseModel sends set-thread-model with the thread id and model and resolves on the reply', async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()
    await flush()
    const before = test.requests().length

    const chosen = test.controller.chooseModel({ ref: 'anthropic/claude-opus-5', effort: 'high' })
    await flush()

    const request = test.requests()[before]
    expect(request?.op).toBe(EClientRequest.SetThreadModel)
    expect(request?.params).toEqual({
      threadId: 'thr_1',
      model: { ref: 'anthropic/claude-opus-5', effort: 'high' },
    })
    if (request === undefined) throw new Error('no request')
    test.receive({
      kind: EServeFrame.Reply,
      replyTo: request.id,
      ok: true,
      data: { threadId: 'thr_1', model: { ref: 'anthropic/claude-opus-5', effort: 'high' } },
    })
    expect(await chosen).toBe(true)
  })

  it('reports a thread-model-changed broadcast made elsewhere', async () => {
    const seen: { ref: string; effort: string }[] = []
    const test = rig({ onModelChanged: (model) => void seen.push(model) })
    test.controller.start()
    await flush()
    test.ready()

    test.receive({
      kind: EServeFrame.ThreadModelChanged,
      threadId: 'thr_1',
      model: { ref: 'openai/gpt-5', effort: 'low' },
    })

    expect(seen).toEqual([{ ref: 'openai/gpt-5', effort: 'low' }])
  })

  it('chooseModel is false without a connected channel', async () => {
    const test = rig()
    expect(await test.controller.chooseModel({ ref: 'a/b', effort: 'low' })).toBe(false)
  })
})

describe('remintDelayMs', () => {
  it('redials at once, then backs off exponentially to a ceiling', () => {
    expect([0, 1, 2, 3, 20].map(remintDelayMs)).toEqual([0, 500, 1000, 2000, 30000])
  })
})
