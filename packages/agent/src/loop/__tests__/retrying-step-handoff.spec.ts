import { describe, expect, it } from 'bun:test'

import { EFinishReason, ModelPort, type Assembled, type ModelStepResult } from '@dltech/atlas-core'

import { instantRetry, transientFailure } from '../../__tests__/exit-fixture'
import { PauseSignal } from '../pause-signal'
import { HandoffAborted } from '../retry-ledger'
import { takeModelStepWithRetry } from '../retrying-step'

const ASSEMBLED: Assembled = { system: [], messages: [] }

const PARTIAL_TEXT = 'half an answer'

const reply = (): ModelStepResult => ({
  parts: [{ type: 'text', text: 'answer' }],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
})

const partial = (): ModelStepResult => ({
  parts: [{ type: 'text', text: PARTIAL_TEXT }],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
})

const until = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

class FailsThenAnswers extends ModelPort {
  readonly identity = { id: 'fails-then-answers', modelId: 'fails-then-answers-1' }
  started = 0

  step: ModelPort['step'] = () => {
    this.started += 1
    return this.started === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(reply())
  }
}

class PartialOnAbort extends ModelPort {
  readonly identity = { id: 'partial-on-abort', modelId: 'partial-on-abort-1' }
  started = 0

  step: ModelPort['step'] = (args) => {
    this.started += 1
    return new Promise<ModelStepResult>((resolve) => {
      args.signal.addEventListener('abort', () => resolve(partial()))
    })
  }
}

describe('a model step during a hand-off', () => {
  it('admits no attempt once the drain paused the turn while a retry prepared', async () => {
    const model = new FailsThenAnswers()
    const pause = new PauseSignal()
    let preparing = 0
    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })

    const attempt = takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: new AbortController().signal,
      retry: instantRetry,
      normalizeFailure: transientFailure,
      pause,
      prepare: async () => {
        preparing += 1
        await gate
        return { ok: true, assembled: ASSEMBLED }
      },
    }).catch((error: unknown) => error)

    await until(() => preparing > 0)
    pause.pause()
    open()

    expect(await attempt).toBeInstanceOf(HandoffAborted)
    expect(model.started).toBe(1)
  })

  it('reports a stream cut by the hand-off as a hand-off, not as a reply', async () => {
    const model = new PartialOnAbort()
    const pause = new PauseSignal()

    const attempt = takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: new AbortController().signal,
      retry: instantRetry,
      normalizeFailure: transientFailure,
      pause,
    })

    await until(() => model.started > 0)
    pause.abortModelStep()

    expect(await attempt).toEqual({ ok: true, result: partial(), handoffAborted: true })
  })

  it('reports a stream that finished before the abort as the reply it is', async () => {
    const model = new FailsThenAnswers()
    const pause = new PauseSignal()

    const attempt = await takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: new AbortController().signal,
      retry: instantRetry,
      normalizeFailure: transientFailure,
      pause,
    })

    expect(attempt).toEqual({ ok: true, result: reply() })
  })
})
