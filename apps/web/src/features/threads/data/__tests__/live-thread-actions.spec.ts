import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-client/channel'

import { EPodConnectOutcome } from '../pod-connect'
import { flush, rig, ticketOf } from './live-thread-fixture'

describe('chooseModel', () => {
  it('sends set-thread-model with the thread id and model and resolves on the reply', async () => {
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

  it('is false without a connected channel', async () => {
    const test = rig()
    expect(await test.controller.chooseModel({ ref: 'a/b', effort: 'low' })).toBe(false)
  })
})

describe('interrupt', () => {
  const interrupts = (test: ReturnType<typeof rig>) =>
    test.sockets.flatMap((socket) =>
      socket.sent.filter((frame) => frame.kind === EClientFrame.Interrupt),
    )

  it('sends the interrupt frame over a connected live channel', async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()

    expect(test.controller.interrupt()).toBe(true)

    expect(interrupts(test)).toEqual([{ kind: EClientFrame.Interrupt }])
  })

  it('refuses to interrupt before the channel connects and returns false', async () => {
    const test = rig()
    expect(test.controller.interrupt()).toBe(false)
    test.controller.start()
    await flush()

    expect(test.controller.interrupt()).toBe(false)

    expect(test.socket().sent).toEqual([])
  })

  it('refuses to interrupt after fallback', async () => {
    const test = rig({
      mints: [ticketOf('tkt1'), { outcome: EPodConnectOutcome.NotRunning }],
    })
    test.controller.start()
    await flush()
    test.ready()
    test.socket().handlers.handleClose()
    await flush()
    expect(test.state().live).toBe(false)

    expect(test.controller.interrupt()).toBe(false)

    expect(interrupts(test)).toEqual([])
  })

  it('reports a lost interrupt when the sandbox never acknowledges it', async () => {
    let lost = 0
    const test = rig({ onInterruptLost: () => void (lost += 1) })
    test.controller.start()
    await flush()
    test.ready()

    test.controller.interrupt()
    for (const timeout of test.timeouts.splice(0)) timeout.run()

    expect(lost).toBe(1)
  })

  it('stays quiet about later failures once the interrupt is acknowledged', async () => {
    let lost = 0
    const test = rig({ onInterruptLost: () => void (lost += 1) })
    test.controller.start()
    await flush()
    test.ready()

    test.controller.interrupt()
    test.receive({ kind: EServeFrame.InterruptAcked, seq: 1 })
    test.receive({ kind: EServeFrame.Error, message: 'unrelated' })
    for (const timeout of test.timeouts.splice(0)) timeout.run()

    expect(lost).toBe(0)
  })
})
