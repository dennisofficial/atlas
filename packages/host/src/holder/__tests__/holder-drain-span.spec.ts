import { describe, expect, it } from 'bun:test'

import { EToolEffect, type ToolOutcome } from '@dltech/atlas-core'
import { FakeTool, ScriptedModel } from '@dltech/atlas-agent/testing'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { DRAIN_IN_FLIGHT_CAP_MS, DRAIN_STREAM_ABORT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession } from './holder-rig'

class StuckTool extends FakeTool {
  started = false

  constructor() {
    super('stuck', 'done', undefined, EToolEffect.Write)
  }

  override async invoke(): Promise<ToolOutcome> {
    this.started = true
    return new Promise<ToolOutcome>(() => {})
  }
}

describe('holder.drain span', () => {
  it('names the tool call that held the drain to its cap', async () => {
    const trace = new RecordingTracer()
    const tool = new StuckTool()
    const model = new ScriptedModel([
      { calls: [{ callId: 'call-1', name: 'stuck', input: {} }] },
      { text: 'done' },
    ])
    const rig = await makeRig({ trace, model: () => model, hostTools: [tool] })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    const draining = rig.holder.drain()
    await rig.flush()
    rig.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
    await rig.flush()
    rig.clock.advance(DRAIN_STREAM_ABORT_CAP_MS)
    await draining

    const [span] = trace.named(ESpan.Drain)
    expect(span?.fields.tool).toBe('stuck')
    expect(span?.fields.extra).toMatchObject({ turnRunning: true, inFlightCapped: true })
    expect(span?.fields.timings?.inFlight).toBeGreaterThanOrEqual(DRAIN_IN_FLIGHT_CAP_MS)
  }, 15_000)
})
