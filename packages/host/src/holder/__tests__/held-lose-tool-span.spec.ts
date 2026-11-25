import { describe, expect, it } from 'bun:test'

import { ESpan, ESpanOutcome } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { flushUntil, makeRig, seedSession } from './holder-rig'

const slowExecScript = [
  {
    calls: [
      { callId: 'call-1', name: 'bash', input: { command: 'echo started; sleep 0.3; echo late' } },
    ],
  },
  { text: 'after' },
] as const

describe('a holder that loses its lease with a call in flight', () => {
  it('closes the tool span as handoff, because the next host takes the call over', async () => {
    const trace = new RecordingTracer()
    const rig = await makeRig({ script: slowExecScript, trace })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('run')
    await rig.wake()
    const dispatched = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'tool-dispatched'),
    })
    expect(dispatched).toBe(true)
    const inFlight = trace.named(ESpan.Tool).find((span) => span.fields.callId === 'call-1')
    expect(inFlight).toBeDefined()

    rig.presence.lose()

    const closed = await flushUntil({
      check: async () => inFlight?.ended === true,
      clock: rig.clock,
      attempts: 3000,
      advanceMs: 1_000,
    })
    expect(closed).toBe(true)
    expect(inFlight?.fields.outcome).toBe(ESpanOutcome.Handoff)
  }, 15_000)
})
