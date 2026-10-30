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

describe('retry', () => {
  const runs = (test: ReturnType<typeof rig>) =>
    test.sockets.flatMap((socket) => socket.sent.filter((frame) => frame.kind === EClientFrame.Run))

  it('sends the run frame over a connected live channel', async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()

    expect(test.controller.retry()).toBe(true)

    expect(runs(test)).toEqual([{ kind: EClientFrame.Run }])
  })

  it('returns false without a connected channel', () => {
    expect(rig().controller.retry()).toBe(false)
  })
})

describe('rewind', () => {
  const cuts = [{ kind: 'shell' as const, shellId: 'sh_1', command: 'bun run dev' }]

  const connectedRig = async () => {
    const test = rig()
    test.controller.start()
    await flush()
    test.ready()
    await flush()
    return test
  }

  it('sends the rewind request over a connected live channel', async () => {
    const test = await connectedRig()
    const before = test.requests().length

    const applied = test.controller.applyRewind({ cuts, toSeq: 3 })
    await flush()

    const request = test.requests()[before]
    expect(request).toMatchObject({
      kind: EClientFrame.Request,
      op: EClientRequest.Rewind,
    })
    expect(request?.params).toEqual({ threadId: 'thr_1', cuts, toSeq: 3 })
    test.reply({ index: before, data: {} })
    await applied
  })

  it('rejects a rewind without a connected channel', async () => {
    const test = rig()
    test.controller.start()
    await flush()

    await expect(test.controller.applyRewind({ cuts, toSeq: 3 })).rejects.toThrow(
      'the sandbox is not connected',
    )
    expect(test.socket().sent).toEqual([])
  })

  it('reads the roster over the channel and parses it', async () => {
    const test = await connectedRig()
    const before = test.requests().length

    const read = test.controller.readRoster()
    await flush()
    expect(test.requests()[before]?.op).toBe(EClientRequest.ListRoster)
    test.reply({
      index: before,
      data: {
        shells: [],
        services: [],
        agents: [
          {
            agentId: 'thr_child',
            spawnedBy: 'thr_1',
            agentType: 'explore',
            intent: 'vault audit',
            status: 'running',
            turns: 1,
            toolCalls: 0,
            startedAt: '2026-10-28T10:00:00.000Z',
          },
        ],
      },
    })

    const roster = await read
    expect(roster?.agents[0]).toMatchObject({
      agentId: 'thr_child',
      status: 'running',
    })
  })

  it('answers null when the roster read fails', async () => {
    const test = await connectedRig()
    const before = test.requests().length

    const read = test.controller.readRoster()
    await flush()
    const request = test.requests()[before]
    if (request === undefined) throw new Error('no request')
    test.receive({
      kind: EServeFrame.Reply,
      replyTo: request.id,
      ok: false,
      data: 'boom',
    })

    expect(await read).toBeNull()
  })

  it('answers null without a connected channel', async () => {
    const test = rig()
    expect(await test.controller.readRoster()).toBeNull()
  })
})
