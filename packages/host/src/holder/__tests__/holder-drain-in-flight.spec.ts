import { describe, expect, it } from 'bun:test'

import {
  EFinishReason,
  EToolEffect,
  ModelPort,
  toCallId,
  type Assembled,
  type ChunkFilter,
  type ModelStepResult,
  type ToolDeclaration,
  type ToolOutcome,
  type RecordEvent,
} from '@dltech/atlas-core'
import { FakeTool, ScriptedModel } from '@dltech/atlas-agent/testing'
import { LogPort } from '@dltech/atlas-observability'

import { DRAIN_IN_FLIGHT_CAP_MS, DRAIN_STREAM_ABORT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const STEP_TEXT = 'working'

class GatedTool extends FakeTool {
  started = false
  runs = 0
  private release: (() => void) | undefined

  constructor(effect: EToolEffect = EToolEffect.Read) {
    super('slow', 'done', undefined, effect)
  }

  releaseNow(): void {
    this.release?.()
  }

  override async invoke(): Promise<ToolOutcome> {
    this.started = true
    this.runs += 1
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    return { ok: true, output: 'done', modelText: 'done' }
  }
}

class MemoryLog extends LogPort {
  readonly entries: { source: unknown; message: string }[] = []
  record(entry: Parameters<LogPort['record']>[0]): void {
    this.entries.push({ source: entry.source, message: entry.message })
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

const eventsOf = async (rig: HolderRig): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
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

const typesOf = (events: readonly RecordEvent[]): string[] => events.map((event) => event.type)

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

  it('waits for an in-process tool to finish and records its result before handing back', async () => {
    const model = new ScriptedModel([...script(), { text: 'done' }])
    const tool = new GatedTool(EToolEffect.Write)
    const a = await makeRig({ model: () => model, hostTools: [tool] })
    await started(a, 'go')
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    let drained = false
    const draining = a.holder.drain().then(() => {
      drained = true
    })
    await a.flush()
    expect(drained).toBe(false)

    tool.releaseNow()
    await draining
    await a.flush()

    const after = await eventsOf(a)
    const results = after.filter((event) => event.type === 'tool-result')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ callId: 'call-1', output: 'done' })
    expect(after.filter((event) => event.type === 'tool-dispatched')).toHaveLength(1)
    expect(typesOf(after)).not.toContain('nudge')
    expect(tool.runs).toBe(1)
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
  }, 15_000)

  it('leaves no open call for the next host, which neither reruns nor interrupts it', async () => {
    const model = new ScriptedModel([...script(), { text: 'done' }])
    const tool = new GatedTool(EToolEffect.Write)
    const a = await makeRig({ model: () => model, hostTools: [tool] })
    await started(a, 'go')
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    tool.releaseNow()
    await draining
    await a.flush()

    const bTool = new FakeTool('slow', 'done', undefined, EToolEffect.Write)
    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'done' }],
      hostTools: [bTool],
    })
    await b.holder.start()
    await b.wake()
    await b.flush()
    await a.flush()

    const after = await eventsOf(a)
    const results = after.filter((event) => event.type === 'tool-result')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ callId: 'call-1', output: 'done' })
    expect(bTool.invocations).toEqual([])
    expect(typesOf(after)).not.toContain('nudge')
  }, 20_000)

  it('hands back at the drain cap when an in-process tool never finishes', async () => {
    const model = new ScriptedModel([...script(), { text: 'done' }])
    const tool = new GatedTool(EToolEffect.Write)
    const log = new MemoryLog()
    const a = await makeRig({ model: () => model, hostTools: [tool], log })
    await started(a, 'go')
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    a.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
    await a.flush()
    a.clock.advance(DRAIN_STREAM_ABORT_CAP_MS)
    await draining
    await a.flush()

    const caps = log.entries.filter((entry) => entry.source === 'holder.drain')
    expect(caps.map((entry) => entry.message).join('\n')).toContain('in-process tool work outlived')
    expect((await eventsOf(a)).filter((event) => event.type === 'tool-result')).toEqual([])
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
    tool.releaseNow()
    await a.flush()
  }, 15_000)
})
