import { describe, expect, it } from 'bun:test'

import {
  EFinishReason,
  ModelPort,
  type Assembled,
  type ModelStepResult,
  type ToolDeclaration,
  type V2Event,
} from '@dltech/atlas-core'
import type { ChunkFilter } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const PARTIAL_TEXT = 'partial answer'

class StreamingModel extends ModelPort {
  readonly identity = { id: 'streaming', modelId: 'streaming-1' }
  started = 0

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
      const partial = (): ModelStepResult => ({
        parts: [{ type: 'text', text: PARTIAL_TEXT }],
        toolCalls: [],
        finishReason: EFinishReason.Stop,
      })
      if (args.signal.aborted) {
        resolve(partial())
        return
      }
      args.signal.addEventListener('abort', () => resolve(partial()), { once: true })
    })
  }
}

const assistantSaids = async (rig: HolderRig) => {
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

describe('SessionHolder handoff with an open model step (exit 3b)', () => {
  it('aborts the stream and revokes at once, without waiting on the turn or a timer', async () => {
    const a = await makeRig({ model: () => new StreamingModel() })
    await seedSession(a)
    await a.holder.start()
    await a.post('say something')
    await a.wake()

    const stepped = await flushUntil({
      check: () => a.runtimes.some((runtime) => (runtime.model as StreamingModel).started > 0),
    })
    expect(stepped).toBe(true)

    const startedAt = a.clock.now()
    await a.holder.drain()
    expect(a.clock.now()).toBe(startedAt)

    const saids = await assistantSaids(a)
    expect(saids.length).toBe(0)

    const lease = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.lease.holderHostId).toBeNull()
    expect(lease.lease.wantsHolder).toBe(true)
    expect(a.bus.wakes.filter((id) => id === SESSION).length).toBeGreaterThanOrEqual(1)
  }, 15_000)
})
