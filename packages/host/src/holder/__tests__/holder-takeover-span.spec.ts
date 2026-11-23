import { describe, expect, it } from 'bun:test'

import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION } from './holder-rig'

describe('take-over span', () => {
  it('emits one root span with the timings of the first step', async () => {
    const trace = new RecordingTracer()
    const rig = await makeRig({ trace, script: [{ text: 'ok' }] })
    await seedSession(rig)
    await rig.holder.start()

    await postAndRun(rig, 'hello')
    const turned = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(turned).toBe(true)

    const spans = trace.named(ESpan.Takeover)
    expect(spans).toHaveLength(1)
    expect(spans[0]?.parent).toBeUndefined()
    expect(spans[0]?.fields.sessionId).toBe(SESSION)
    expect(spans[0]?.fields.timings?.firstStep).toBeGreaterThanOrEqual(0)
    expect(spans[0]?.fields.timings?.claim).toBeGreaterThanOrEqual(0)
    expect(spans[0]?.fields.timings?.config).toBeGreaterThanOrEqual(0)
    expect(spans[0]?.fields.timings?.record).toBeGreaterThanOrEqual(0)
    expect(spans[0]?.ended).toBe(true)
  })
})
