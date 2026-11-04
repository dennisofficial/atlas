import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

describe('SessionHolder daemon ack probe on claim (F9)', () => {
  it('a result whose ack was lost is acked on the next claim instead of rerun', async () => {
    const a = await makeRig({
      holderId: 'holder-a',
      script: [
        { calls: [{ callId: 'call-1', name: 'bash', input: { command: 'echo one' } }] },
        { text: 'after the call' },
      ],
    })
    await seedSession(a)

    let dropping = true
    const originalConnect = a.daemon.connectRaw.bind(a.daemon)
    a.daemon.connectRaw = (handlers) => {
      const socket = originalConnect(handlers)
      const send = socket.send.bind(socket)
      socket.send = (text) => {
        if (!(dropping && text.includes('"ack"'))) send(text)
      }
      return socket
    }

    await a.holder.start()
    await a.post('run it')
    await a.wake()
    const resultSaw = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'tool-result'),
    })
    expect(resultSaw).toBe(true)
    expect(a.daemon.runCount()).toBe(1)

    await a.holder.discard()
    dropping = false
    a.clock.advance(31_000)

    const b = await makeRig({
      holderId: 'holder-b',
      plane: a.plane,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'collected' }],
    })
    await b.holder.start()
    await a.post('are you there')
    await a.bus.wake(SESSION)
    const done = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
      attempts: 200,
    })
    expect(done).toBe(true)
    expect(a.daemon.runCount()).toBe(1)
    const acked = b.runtimes.flatMap((runtime) => runtime.ackedScopes)
    expect(acked.some((key) => key.endsWith(':call-1'))).toBe(true)
  }, 15_000)
})
