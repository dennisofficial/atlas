import { describe, expect, it } from 'bun:test'

import {
  EFinishReason,
  ModelPort,
  type Assembled,
  type ChunkFilter,
  type ModelStepResult,
  type ToolDeclaration,
  type RecordEvent,
} from '@dltech/atlas-core'
import { LogPort } from '@dltech/atlas-observability'

import { DRAIN_IN_FLIGHT_CAP_MS, DRAIN_STREAM_ABORT_CAP_MS } from '../drain-cap'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const PARTIAL_TEXT = 'partial answer'

const result = (): ModelStepResult => ({
  parts: [{ type: 'text', text: PARTIAL_TEXT }],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
})

class GatedModel extends ModelPort {
  readonly identity = { id: 'gated', modelId: 'gated-1' }
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
    emit({ type: 'text-delta', id: 'text-1', text: PARTIAL_TEXT })
    return new Promise<ModelStepResult>((resolve) => {
      this.finish = () => resolve(result())
    })
  }
}

class PartialOnAbortModel extends ModelPort {
  readonly identity = { id: 'partial-on-abort', modelId: 'partial-on-abort-1' }
  started = 0

  step: ModelPort['step'] = (args: { signal: AbortSignal }) => {
    this.started += 1
    return new Promise<ModelStepResult>((resolve) => {
      args.signal.addEventListener('abort', () => resolve(result()))
    })
  }
}

class StuckModel extends ModelPort {
  readonly identity = { id: 'stuck', modelId: 'stuck-1' }
  started = 0

  step: ModelPort['step'] = () => {
    this.started += 1
    return new Promise<ModelStepResult>(() => {})
  }
}

class MemoryLog extends LogPort {
  readonly entries: { source: unknown; message: string }[] = []
  record(entry: Parameters<LogPort['record']>[0]): void {
    this.entries.push({ source: entry.source, message: entry.message })
  }
}

const saids = async (rig: HolderRig) => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1000,
    visible: false,
  })
  return page.events.filter(
    (event): event is Extract<RecordEvent, { type: 'assistant-said' }> =>
      event.type === 'assistant-said',
  )
}

const nudges = async (rig: HolderRig) => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1000,
    visible: false,
  })
  return page.events.filter((event) => event.type === 'nudge')
}

const repliesOf = async (rig: HolderRig) =>
  (await saids(rig)).map((event) => ({
    text: event.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
    interrupted: event.interrupted,
    aborted: event.aborted,
  }))

describe('SessionHolder handoff with an open model step (exit 3b)', () => {
  it('lets a streaming step finish and commit, then hands the lease back', async () => {
    const model = new GatedModel()
    const a = await makeRig({ model: () => model })
    await seedSession(a)
    await a.holder.start()
    await a.post('say something')
    await a.wake()

    const streaming = await flushUntil({ check: () => model.started > 0 })
    expect(streaming).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    model.finishStep()
    await draining

    const [said] = await saids(a)
    expect(said?.interrupted).toBeUndefined()
    expect(said?.aborted).toBeUndefined()
    expect(await nudges(a)).toEqual([])

    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
  }, 15_000)

  it('aborts past the drain cap, warns with what was in flight, and records no reply', async () => {
    const model = new StuckModel()
    const log = new MemoryLog()
    const a = await makeRig({ model: () => model, log })
    await seedSession(a)
    await a.holder.start()
    await a.post('say something')
    await a.wake()
    expect(await flushUntil({ check: () => model.started > 0 })).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    a.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
    await a.flush()
    a.clock.advance(DRAIN_STREAM_ABORT_CAP_MS)
    await draining

    expect(await saids(a)).toEqual([])
    expect(await nudges(a)).toEqual([])
    const caps = log.entries.filter((entry) => entry.source === 'holder.drain')
    expect(caps).toHaveLength(2)
    expect(caps[0]?.message).toContain('drain cap')
    expect(caps[0]?.message).toContain('model step')
    expect(caps[1]?.message).toContain('model stream outlived')
  }, 15_000)

  it('records a stream cut at the cap as a handoff reply, and the next holder asks again', async () => {
    const model = new PartialOnAbortModel()
    const a = await makeRig({ model: () => model })
    await seedSession(a)
    await a.holder.start()
    await a.post('say something')
    await a.wake()
    expect(await flushUntil({ check: () => model.started > 0 })).toBe(true)

    const draining = a.holder.drain()
    await a.flush()
    a.clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
    await a.flush()
    a.clock.advance(DRAIN_STREAM_ABORT_CAP_MS)
    await draining
    await a.flush()

    expect(await repliesOf(a)).toEqual([
      { text: PARTIAL_TEXT, interrupted: true, aborted: 'handoff' },
    ])
    expect(await nudges(a)).toEqual([])

    const b = await makeRig({
      plane: a.plane,
      store: a.store,
      bus: a.bus,
      clock: a.clock,
      daemon: a.daemon,
      script: [{ text: 'host b answered' }],
    })
    await b.holder.start()
    await b.wake()
    await b.flush()
    await a.flush()

    const asked = await flushUntil({
      check: async () => (await saids(a)).length === 2,
      attempts: 200,
      clock: a.clock,
    })
    expect(asked).toBe(true)
    expect(await repliesOf(a)).toEqual([
      { text: PARTIAL_TEXT, interrupted: true, aborted: 'handoff' },
      { text: 'host b answered', interrupted: undefined, aborted: undefined },
    ])
  }, 20_000)
})
