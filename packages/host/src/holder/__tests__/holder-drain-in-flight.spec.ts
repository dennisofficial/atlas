import { describe, expect, it } from 'bun:test'

import {
  EFinishReason,
  ModelPort,
  toCallId,
  type Assembled,
  type ChunkFilter,
  type ModelStepResult,
  type ToolDeclaration,
  type ToolOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import { FakeTool, ScriptedModel } from '@dltech/atlas-agent/testing'

import { DRAIN_IN_FLIGHT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const STEP_TEXT = 'working'

class GatedTool extends FakeTool {
  started = false
  private release: (() => void) | undefined

  constructor() {
    super('slow', 'done')
  }

  releaseNow(): void {
    this.release?.()
  }

  override async invoke(): Promise<ToolOutcome> {
    this.started = true
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    return { ok: true, output: 'done', modelText: 'done' }
  }
}

class CallThenGateModel extends ModelPort {
  readonly identity = { id: 'call-then-gate', modelId: 'call-then-gate-1' }
  started = 0
  private finish: (() => void) | undefined

  finishStep(): void {
    this.finish?.()
  }

  step: ModelPort['step'] = (args: {
    assembled: Assembled
    tools: readonly ToolDeclaration[]
    signal: AbortSignal
    onChunk?: ChunkFilter
  }) => {
    this.started += 1
    const emit = args.onChunk ?? ((chunk) => chunk)
    emit({ type: 'text-start', id: 'text-1' })
    emit({ type: 'text-delta', id: 'text-1', text: STEP_TEXT })
    return new Promise<ModelStepResult>((resolve) => {
      this.finish = () =>
        resolve({
          parts: [{ type: 'text', text: STEP_TEXT }],
          toolCalls: [{ callId: toCallId('call-1'), name: 'slow', input: {} }],
          finishReason: EFinishReason.ToolCalls,
        })
    })
  }
}

const eventsOf = async (rig: HolderRig): Promise<V2Event[]> => {
  const events: V2Event[] = []
  let afterSeq = 0
  for (;;) {
    const page = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq,
      limit: 1000,
      visible: false,
    })
    events.push(...page.events)
    if (page.next === undefined) return events
    afterSeq = page.next
  }
}

const typesOf = (events: readonly V2Event[]): string[] => events.map((event) => event.type)

const started = async (rig: HolderRig, text: string): Promise<void> => {
  await seedSession(rig)
  await rig.holder.start()
  await rig.post(text)
  await rig.wake()
}

const script = (): readonly { calls: { callId: string; name: string; input: unknown }[] }[] => [
  { calls: [{ callId: 'call-1', name: 'slow', input: {} }] },
]

describe('SessionHolder drain with work in flight', () => {
  it('hands back before dispatching the call of a step that landed during the drain', async () => {
    const model = new CallThenGateModel()
    const tool = new GatedTool()
    const a = await makeRig({ model: () => model, hostTools: [tool] })
    await started(a, 'go')
    expect(await flushUntil({ check: () => model.started > 0 })).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    model.finishStep()
    await draining
    await a.flush()

    const events = await eventsOf(a)
    expect(model.started).toBe(1)
    expect(tool.started).toBe(false)
    expect(typesOf(events)).not.toContain('tool-dispatched')
    expect(typesOf(events)).not.toContain('nudge')
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
  }, 15_000)

  it('records a host-side tool that was in flight when the drain began', async () => {
    const model = new ScriptedModel([...script(), { text: 'done' }])
    const tool = new GatedTool()
    const a = await makeRig({ model: () => model, hostTools: [tool] })
    await started(a, 'go')
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    tool.releaseNow()
    await draining

    const events = await eventsOf(a)
    const results = events.filter((event) => event.type === 'tool-result')
    expect(results).toHaveLength(1)
    expect(results[0]).not.toMatchObject({ interrupted: true })
    expect(model.requests).toHaveLength(1)
    expect(typesOf(events)).not.toContain('nudge')
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
  }, 15_000)

  it('marks a call the cap detached so the next host runs it instead of settling a crash', async () => {
    const model = new ScriptedModel([...script(), { text: 'done' }])
    const tool = new GatedTool()
    const a = await makeRig({ model: () => model, hostTools: [tool] })
    await started(a, 'go')
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    a.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)

    const detached = await flushUntil({
      check: async () =>
        (await eventsOf(a)).some(
          (event) => event.type === 'tool-dispatched' && event.detached === true,
        ),
    })
    expect(detached).toBe(true)
    tool.releaseNow()
    await a.flush()
    await draining

    const drained = await eventsOf(a)
    expect(drained.filter((event) => event.type === 'tool-result')).toEqual([])
    expect(typesOf(drained)).not.toContain('nudge')

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'done' }],
      hostTools: [new FakeTool('slow', 'done')],
    })
    await b.holder.start()
    await b.wake()

    const rerun = await flushUntil({
      check: async () => (await eventsOf(a)).some((event) => event.type === 'tool-result'),
      attempts: 200,
      clock: a.clock,
    })
    expect(rerun).toBe(true)

    const after = await eventsOf(a)
    expect(after.filter((event) => event.type === 'tool-result')).toHaveLength(1)
    expect(
      after.filter((event) => event.type === 'tool-result' && event.interrupted === true),
    ).toEqual([])
    expect(typesOf(after)).not.toContain('nudge')
  }, 20_000)
})
