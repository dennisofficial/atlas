import { describe, expect, it } from 'bun:test'

import {
  EFinishReason,
  ModelPort,
  type Assembled,
  type ChunkFilter,
  type ModelStepResult,
  type ToolDeclaration,
  type V2Event,
} from '@dltech/atlas-core'
import { LogPort } from '@dltech/atlas-observability'

import { DRAIN_IN_FLIGHT_CAP_MS } from '../drain-cap'
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
    (event): event is Extract<V2Event, { type: 'assistant-said' }> =>
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
    await draining

    expect(await saids(a)).toEqual([])
    expect(await nudges(a)).toEqual([])
    const caps = log.entries.filter((entry) => entry.source === 'holder.drain')
    expect(caps).toHaveLength(1)
    expect(caps[0]?.message).toContain('drain cap')
    expect(caps[0]?.message).toContain('model step')
  }, 15_000)
})
