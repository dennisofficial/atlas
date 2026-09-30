import { describe, expect, it } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'

import {
  DEFAULT_RETRY_POLICY,
  ERetryReason,
  ModelPort,
  planRetry,
  type Assembled,
  type ModelStepResult,
  type ProviderPrompt,
} from '@dltech/atlas-core'

import { DEFAULT_STREAM_TIMEOUT, runModelStream } from '../../model/ai-sdk-model-port'
import { StreamStallError } from '../../model/errors'
import { providerPartsFor } from '../../model/testing/scripted-model'
import { takeModelStepWithRetry, type RetryNotice } from '../retrying-step'

const prompt: ProviderPrompt = {
  instructions: [],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
  provider: { id: 'test', modelId: 'stalled-provider' },
}

class UnansweredModel extends ModelPort {
  readonly identity = prompt.provider
  calls = 0
  aborted = 0

  constructor(private readonly failures: number) {
    super()
  }

  async step({ signal }: { signal: AbortSignal }): Promise<ModelStepResult> {
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        this.calls += 1
        if (this.calls <= this.failures) {
          return new Promise<never>(() => {
            abortSignal?.addEventListener('abort', () => {
              this.aborted += 1
            }, { once: true })
          })
        }
        return {
          stream: new ReadableStream({
            start(controller) {
              for (const part of providerPartsFor({ text: 'recovered' })) controller.enqueue(part)
              controller.close()
            },
          }),
        }
      },
    })
    return runModelStream({
      model,
      prompt,
      tools: [],
      signal,
      streamTimeout: { ...DEFAULT_STREAM_TIMEOUT, ttfbMs: 25 },
    })
  }
}

function retrying(args: { failures: number }) {
  const model = new UnansweredModel(args.failures)
  const slept: number[] = []
  const notices: RetryNotice[] = []
  const assembled: Assembled = { messages: [], system: [] }
  const run = () => takeModelStepWithRetry({
    model,
    tools: [],
    onChunk: undefined,
    assembled,
    signal: new AbortController().signal,
    retry: {
      jitter: () => 1,
      sleep: async ({ ms }) => { slept.push(ms) },
      onWaiting: (notice) => notices.push(notice),
    },
  })
  return { model, slept, notices, run }
}

describe('default cadence for unanswered provider requests', () => {
  it('budgets at most 165 seconds across five unanswered requests and their backoffs', () => {
    let waitingMs = 0
    for (let attempts = 1; attempts <= DEFAULT_RETRY_POLICY.maxAttempts; attempts += 1) {
      const decision = planRetry({ failure: {}, attempts, policy: DEFAULT_RETRY_POLICY, jitter: 1 })
      if (decision.retry) waitingMs += decision.delayMs
    }
    expect(DEFAULT_STREAM_TIMEOUT.ttfbMs).toBe(30_000)
    expect(DEFAULT_RETRY_POLICY.maxAttempts * DEFAULT_STREAM_TIMEOUT.ttfbMs + waitingMs).toBe(165_000)
    expect(DEFAULT_STREAM_TIMEOUT.firstChunkMs).toBe(180_000)
    expect(DEFAULT_STREAM_TIMEOUT.chunkMs).toBe(120_000)
  })

  it('retries real stream deadlines and stops after five calls, aborting each request', async () => {
    const { model, slept, notices, run } = retrying({ failures: 10 })

    await expect(run()).rejects.toThrow(StreamStallError)

    expect(model.calls).toBe(5)
    expect(model.aborted).toBe(5)
    expect(slept).toEqual([1_000, 2_000, 4_000, 8_000])
    expect(notices.map((notice) => notice.reason)).toEqual(Array(4).fill(ERetryReason.Network))
    expect(notices.map((notice) => notice.maxAttempts)).toEqual([5, 5, 5, 5])
  })

  it('returns a recovered response instead of exhausting the remaining attempts', async () => {
    const { model, slept, run } = retrying({ failures: 2 })

    const result = await run()

    expect(result.ok).toBe(true)
    expect(model.calls).toBe(3)
    expect(model.aborted).toBe(2)
    expect(slept).toEqual([1_000, 2_000])
  })
})
