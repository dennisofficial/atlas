import { describe, expect, it } from 'bun:test'

import { EFinishReason, type Chunk, type ModelStepResult } from '@dltech/atlas-core'
import type { SpanFields, SpanHandle } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { FirstTokenClock } from '../first-token'
import { TracedModel } from '../traced-model'

const TEXT_CHUNK: Chunk = { type: 'text-delta', id: 't', text: 'a' }

const DONE: ModelStepResult = {
  parts: [],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
}

const handleOf = (): { handle: SpanHandle; sets: SpanFields[] } => {
  const sets: SpanFields[] = []
  return { handle: { set: (fields) => sets.push(fields), mark: () => {} }, sets }
}

const modelOf = (args: {
  firstToken: FirstTokenClock
  steps: ((onChunk?: (chunk: Chunk) => void) => void)[]
}): TracedModel => {
  let calls = 0
  return new TracedModel({
    trace: new RecordingTracer(),
    firstToken: args.firstToken,
    inner: {
      identity: { id: 'p', modelId: 'm' },
      step: async ({ onChunk }) => {
        const run = args.steps[calls]
        calls += 1
        run?.(onChunk)
        return DONE
      },
    },
  })
}

const stepOf = (model: TracedModel): Promise<ModelStepResult> =>
  model.step({
    assembled: { system: [], messages: [] },
    tools: [],
    signal: new AbortController().signal,
  })

describe('FirstTokenClock', () => {
  it('records nothing when the prompt time is unknown', async () => {
    const clock = new FirstTokenClock(() => 1500)
    const { handle, sets } = handleOf()
    const model = modelOf({ firstToken: clock, steps: [(onChunk) => onChunk?.(TEXT_CHUNK)] })

    clock.arm({ span: handle, promptAt: undefined })
    await stepOf(model)

    expect(sets).toEqual([])
  })

  it('records the first chunk of the first call', async () => {
    const clock = new FirstTokenClock(() => 1500)
    const { handle, sets } = handleOf()
    const model = modelOf({ firstToken: clock, steps: [(onChunk) => onChunk?.(TEXT_CHUNK)] })

    clock.arm({ span: handle, promptAt: 500 })
    await stepOf(model)

    expect(sets).toEqual([{ firstTokenMs: 1000 }])
  })

  it('records once across the calls of one turn', async () => {
    const clock = new FirstTokenClock(() => 1500)
    const { handle, sets } = handleOf()
    const model = modelOf({
      firstToken: clock,
      steps: [
        (onChunk) => {
          onChunk?.(TEXT_CHUNK)
          onChunk?.(TEXT_CHUNK)
        },
        (onChunk) => onChunk?.(TEXT_CHUNK),
      ],
    })

    clock.arm({ span: handle, promptAt: 500 })
    await stepOf(model)
    await stepOf(model)

    expect(sets).toEqual([{ firstTokenMs: 1000 }])
  })

  it('records nothing when the first call of the turn ended before any chunk', async () => {
    const clock = new FirstTokenClock(() => 1500)
    const { handle, sets } = handleOf()
    const model = modelOf({
      firstToken: clock,
      steps: [() => {}, (onChunk) => onChunk?.(TEXT_CHUNK)],
    })

    clock.arm({ span: handle, promptAt: 500 })
    await stepOf(model)
    await stepOf(model)

    expect(sets).toEqual([])
  })

  it('measures each turn from its own prompt post time', async () => {
    let now = 1500
    const clock = new FirstTokenClock(() => now)
    const first = handleOf()
    const second = handleOf()
    const model = modelOf({
      firstToken: clock,
      steps: [(onChunk) => onChunk?.(TEXT_CHUNK), (onChunk) => onChunk?.(TEXT_CHUNK)],
    })

    clock.arm({ span: first.handle, promptAt: 500 })
    await stepOf(model)
    clock.disarm()

    now = 9000
    clock.arm({ span: second.handle, promptAt: 8000 })
    await stepOf(model)

    expect(first.sets).toEqual([{ firstTokenMs: 1000 }])
    expect(second.sets).toEqual([{ firstTokenMs: 1000 }])
  })

  it('records nothing after the turn ends', async () => {
    const clock = new FirstTokenClock(() => 1500)
    const { handle, sets } = handleOf()
    const model = modelOf({
      firstToken: clock,
      steps: [() => {}, (onChunk) => onChunk?.(TEXT_CHUNK)],
    })

    clock.arm({ span: handle, promptAt: 500 })
    clock.disarm()
    await stepOf(model)

    expect(sets).toEqual([])
  })
})
