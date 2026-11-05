import { describe, expect, it } from 'bun:test'
import { ScriptedModel } from '@dltech/atlas-agent/testing'

import { flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

describe('SessionHolder first turn on a parked sandbox', () => {
  it('starts the turn before the daemon link is ready and acks once it is', async () => {
    const a = await makeRig({
      script: [
        { calls: [{ callId: 'call-1', name: 'bash', input: { command: 'echo one' } }] },
        { text: 'after the call' },
      ],
    })
    await seedSession(a)
    await a.holder.start()
    await a.post('run it')
    await a.wake()
    const first = await flushUntil({
      check: async () => (await a.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(first).toBe(true)
    await a.holder.discard()
    a.presence.lose()
    a.clock.advance(31_000)

    const gate = Promise.withResolvers<void>()
    const model = new ScriptedModel([
      { calls: [{ callId: 'call-2', name: 'bash', input: { command: 'echo two' } }] },
      { text: 'done' },
    ])
    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      model: () => model,
      connectGate: gate.promise,
    })
    await b.holder.start()
    await a.post('again')
    await a.bus.wake(SESSION)

    const thinking = await flushUntil({ check: () => model.requests.length > 0 })
    expect(thinking).toBe(true)
    const beforeGate = await a.events()
    expect(beforeGate.filter((event) => event.type === 'user-said')).toHaveLength(2)
    expect(beforeGate.some((event) => event.type === 'tool-dispatched' && event.seq > 5)).toBe(
      false,
    )
    expect(a.daemon.runCount()).toBe(1)
    expect(b.runtimes.flatMap((runtime) => runtime.ackedScopes)).toEqual([])

    gate.resolve()
    const done = await flushUntil({
      check: async () => (await a.events()).filter((e) => e.type === 'assistant-said').length === 2,
      attempts: 200,
    })
    expect(done).toBe(true)
    expect(a.daemon.runCount()).toBe(2)
    const acked = b.runtimes.flatMap((runtime) => runtime.ackedScopes)
    expect(acked.some((key) => key.endsWith(':call-1'))).toBe(true)
  }, 15_000)
})
