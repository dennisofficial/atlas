import { describe, expect, it } from 'bun:test'
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'

import type { ProviderIdentity, ProviderPrompt } from '@dltech/atlas-core'

import { WakeSignalSource } from '../../wake/wake-signal-source'
import { runModelStream } from '../ai-sdk-model-port'
import { wakeAbortsStream } from '../wake-aware-model'
import { StreamStallError } from '../errors'
import { modelFailureOf } from '../failure'
import { providerPartsFor } from '../testing/scripted-model'

const identity: ProviderIdentity = { id: 'anthropic', modelId: 'claude-opus-5' }

const prompt: ProviderPrompt = {
  instructions: [],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
  provider: identity,
}

const PATIENT = { ttfbMs: 5_000, firstChunkMs: 5_000, chunkMs: 5_000 }

const silentModel = (): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          abortSignal?.addEventListener('abort', () => controller.error(abortSignal.reason))
        },
      }),
    }),
  })

const runSilent = (wake: WakeSignalSource) =>
  runModelStream({
    model: wakeAbortsStream({ model: silentModel(), wake }),
    prompt,
    tools: [],
    signal: new AbortController().signal,
    streamTimeout: PATIENT,
  })

// Firing from the task queue matches how the detector's interval delivers a wake: streamText
// subscribes synchronously inside the task that started the stream, so a wake always lands in a
// later task.
const wakeOnNextTask = (wake: WakeSignalSource): void => {
  setTimeout(() => wake.fire({ gapMs: 90_000 }), 0)
}

describe('a stream in flight when the machine wakes', () => {
  it('fails with a stall as soon as the wake fires, instead of hanging half-open', async () => {
    const wake = new WakeSignalSource()
    const running = runSilent(wake)

    wakeOnNextTask(wake)

    await expect(running).rejects.toThrow(StreamStallError)
  })

  it('classifies a wake abort exactly like a TTFB stall, as a retryable dropped connection', async () => {
    const wake = new WakeSignalSource()
    const running = runSilent(wake)

    wakeOnNextTask(wake)
    const error = await running.catch((caught: unknown) => caught)

    expect(modelFailureOf(error)).toEqual({})
  })

  it('leaves a stream alone when no wake fires', async () => {
    const wake = new WakeSignalSource()
    const model = wakeAbortsStream({ model: silentModel(), wake })
    const done = new AbortController()

    const running = runModelStream({
      model,
      prompt,
      tools: [],
      signal: done.signal,
      streamTimeout: PATIENT,
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(wake.wasWakeRecent(60_000)).toBe(false)
    done.abort()
    const result = await running
    expect(result.parts).toEqual([])
  })
})

describe('a request issued right after a wake', () => {
  it('asks the provider for a fresh connection, so Bun does not hand it a dead keep-alive socket', async () => {
    let nowMs = 0
    const wake = new WakeSignalSource({ now: () => nowMs })
    const seenHeaders: Array<Record<string, string | undefined> | undefined> = []

    const healthy = new MockLanguageModelV4({
      doStream: async (options: LanguageModelV4CallOptions) => {
        seenHeaders.push(options.headers)
        return {
          stream: simulateReadableStream<LanguageModelV4StreamPart>({
            chunks: providerPartsFor({ text: 'reconnected' }),
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
        }
      },
    })

    const model = wakeAbortsStream({ model: healthy, wake })
    const first = await runModelStream({
      model,
      prompt,
      tools: [],
      signal: new AbortController().signal,
      streamTimeout: PATIENT,
    })
    expect(first.parts).toEqual([{ type: 'text', text: 'reconnected' }])

    wake.fire({ gapMs: 90_000 })
    nowMs = 1_000

    const second = await runModelStream({
      model,
      prompt,
      tools: [],
      signal: new AbortController().signal,
      streamTimeout: PATIENT,
    })

    expect(second.parts).toEqual([{ type: 'text', text: 'reconnected' }])
    expect(seenHeaders[0]).toBeUndefined()
    expect(seenHeaders[1]?.connection).toBe('close')
  })

  it('keeps a LanguageModelV4 property lookup passing through to the wrapped model', () => {
    const wake = new WakeSignalSource()
    const inner = silentModel()
    const model: LanguageModelV4 = wakeAbortsStream({ model: inner, wake })

    expect(model.provider).toBe(inner.provider)
    expect(model.modelId).toBe(inner.modelId)
    expect(model.specificationVersion).toBe('v4')
  })
})
