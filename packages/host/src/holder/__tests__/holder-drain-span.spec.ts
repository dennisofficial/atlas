import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  ModelPort,
  type Assembled,
  type ChunkFilter,
  type ModelStepResult,
  type ToolDeclaration,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { FakeTool, ScriptedModel } from '@dltech/atlas-agent/testing'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { DRAIN_IN_FLIGHT_CAP_MS, DRAIN_STREAM_ABORT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession } from './holder-rig'

class StalledStream extends ModelPort {
  readonly identity = { id: 'stalled', modelId: 'stalled-1' }
  started = 0

  step = (args: {
    assembled: Assembled
    tools: readonly ToolDeclaration[]
    signal: AbortSignal
    onChunk?: ChunkFilter
  }): Promise<ModelStepResult> => {
    this.started += 1
    return new Promise<ModelStepResult>((_resolve, reject) => {
      args.signal.addEventListener('abort', () => reject(args.signal.reason), { once: true })
    })
  }
}

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
  it('marks the in-flight cap and times it when the model stream stalls', async () => {
    const trace = new RecordingTracer()
    const model = new StalledStream()
    const rig = await makeRig({ trace, model: () => model })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    expect(await flushUntil({ check: () => model.started > 0 })).toBe(true)

    const draining = rig.holder.drain()
    await rig.flush()
    rig.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
    await rig.flush()
    rig.clock.advance(DRAIN_STREAM_ABORT_CAP_MS)
    await draining

    const [span] = trace.named(ESpan.Drain)
    expect(span?.fields.extra).toMatchObject({ turnRunning: true, inFlightCapped: true })
    expect(span?.fields.timings?.inFlight).toBeGreaterThanOrEqual(DRAIN_IN_FLIGHT_CAP_MS)
    expect(span?.fields.tool).toBeUndefined()
  }, 15_000)

  it('leaves the cap unmarked when only a tool still runs', async () => {
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

    await rig.holder.drain()
    await rig.flush()

    const [span] = trace.named(ESpan.Drain)
    expect(span?.fields.extra).toMatchObject({ turnRunning: true, inFlightCapped: false })
    expect(span?.fields.tool).toBeUndefined()
  }, 15_000)
})
