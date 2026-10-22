import type {
  LanguageModelV4,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'
import { describe, expect, it } from 'bun:test'

import { createFallbackModel } from '../fallback-model'

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
}

const generated = (text: string): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: 'stop', raw: undefined },
  usage: USAGE,
  warnings: [],
})

const delta = (text: string): LanguageModelV4StreamPart => ({ type: 'text-delta', id: 'one', delta: text })

const streamOf = (parts: readonly LanguageModelV4StreamPart[]): LanguageModelV4StreamResult => ({
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  }),
})

const streamDying = (
  fault: unknown,
  after: readonly LanguageModelV4StreamPart[] = [],
): LanguageModelV4StreamResult => {
  let delivered = 0
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      pull(controller) {
        const part = after[delivered]
        if (part === undefined) {
          controller.error(fault)
          return
        }
        delivered += 1
        controller.enqueue(part)
      },
    }),
  }
}

const collect = async (
  stream: ReadableStream<LanguageModelV4StreamPart>,
): Promise<LanguageModelV4StreamPart[]> => {
  const reader = stream.getReader()
  const parts: LanguageModelV4StreamPart[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return parts
    parts.push(value)
  }
}

const modelWith = (args: {
  modelId: string
  generate?: () => Promise<LanguageModelV4GenerateResult>
  stream?: () => Promise<LanguageModelV4StreamResult>
}): LanguageModelV4 => ({
  specificationVersion: 'v4',
  provider: 'fake',
  modelId: args.modelId,
  supportedUrls: {},
  doGenerate:
    args.generate ??
    (async () => {
      throw new Error('doGenerate is not under test')
    }),
  doStream:
    args.stream ??
    (async () => {
      throw new Error('doStream is not under test')
    }),
})

describe('createFallbackModel', () => {
  it('answers with the primary while the primary works', async () => {
    let fallbackBuilt = 0
    const model = createFallbackModel({
      primary: modelWith({ modelId: 'primary', generate: async () => generated('from primary') }),
      fallback: () => {
        fallbackBuilt += 1
        return modelWith({ modelId: 'fallback' })
      },
      onFallback: () => {},
    })

    const result = await model.doGenerate({ prompt: [] })

    expect(result.content).toEqual([{ type: 'text', text: 'from primary' }])
    expect(fallbackBuilt).toBe(0)
  })

  it('retries a failed generation against a fallback built at fault time', async () => {
    const down = new Error('provider is down')
    const faults: unknown[] = []
    let fallbackBuilt = 0
    const model = createFallbackModel({
      primary: modelWith({
        modelId: 'primary',
        generate: async () => {
          throw down
        },
      }),
      fallback: () => {
        fallbackBuilt += 1
        return modelWith({ modelId: 'fallback', generate: async () => generated('from fallback') })
      },
      onFallback: (fault) => faults.push(fault),
    })

    const result = await model.doGenerate({ prompt: [] })

    expect(result.content).toEqual([{ type: 'text', text: 'from fallback' }])
    expect(faults).toEqual([down])
    expect(fallbackBuilt).toBe(1)
  })

  it('rethrows the primary fault when no fallback can answer', async () => {
    const down = new Error('provider is down')
    const model = createFallbackModel({
      primary: modelWith({
        modelId: 'primary',
        generate: async () => {
          throw down
        },
      }),
      fallback: () => undefined,
      onFallback: () => {},
    })

    await expect(model.doGenerate({ prompt: [] })).rejects.toBe(down)
  })

  it("lets the fallback's own failure reach the caller", async () => {
    const alsoDown = new Error('session model is down too')
    const model = createFallbackModel({
      primary: modelWith({
        modelId: 'primary',
        generate: async () => {
          throw new Error('provider is down')
        },
      }),
      fallback: () =>
        modelWith({
          modelId: 'fallback',
          generate: async () => {
            throw alsoDown
          },
        }),
      onFallback: () => {},
    })

    await expect(model.doGenerate({ prompt: [] })).rejects.toBe(alsoDown)
  })

  it('builds the fallback per fault, so each failure sees the current choice', async () => {
    const choices = ['first-choice', 'second-choice']
    const built: string[] = []
    const model = createFallbackModel({
      primary: modelWith({
        modelId: 'primary',
        generate: async () => {
          throw new Error('provider is down')
        },
      }),
      fallback: () => {
        const modelId = choices[built.length] ?? 'exhausted'
        built.push(modelId)
        return modelWith({ modelId, generate: async () => generated(`from ${modelId}`) })
      },
      onFallback: () => {},
    })

    const first = await model.doGenerate({ prompt: [] })
    const second = await model.doGenerate({ prompt: [] })

    expect(built).toEqual(['first-choice', 'second-choice'])
    expect(first.content).toEqual([{ type: 'text', text: 'from first-choice' }])
    expect(second.content).toEqual([{ type: 'text', text: 'from second-choice' }])
  })

  it('takes over a stream the primary refuses to open', async () => {
    const down = new Error('provider is down')
    const faults: unknown[] = []
    const model = createFallbackModel({
      primary: modelWith({
        modelId: 'primary',
        stream: async () => {
          throw down
        },
      }),
      fallback: () =>
        modelWith({ modelId: 'fallback', stream: async () => streamOf([delta('from fallback')]) }),
      onFallback: (fault) => faults.push(fault),
    })

    const result = await model.doStream({ prompt: [] })

    expect(await collect(result.stream)).toEqual([delta('from fallback')])
    expect(faults).toEqual([down])
  })

  it('restarts a stream that dies before its first chunk', async () => {
    const down = new Error('connection reset')
    const model = createFallbackModel({
      primary: modelWith({ modelId: 'primary', stream: async () => streamDying(down) }),
      fallback: () =>
        modelWith({ modelId: 'fallback', stream: async () => streamOf([delta('from fallback')]) }),
      onFallback: () => {},
    })

    const result = await model.doStream({ prompt: [] })

    expect(await collect(result.stream)).toEqual([delta('from fallback')])
  })

  it('propagates a stream failure once output has flowed, rather than duplicating it', async () => {
    const down = new Error('connection reset')
    let fallbackBuilt = 0
    const model = createFallbackModel({
      primary: modelWith({
        modelId: 'primary',
        stream: async () => streamDying(down, [delta('partial')]),
      }),
      fallback: () => {
        fallbackBuilt += 1
        return modelWith({ modelId: 'fallback' })
      },
      onFallback: () => {},
    })

    const result = await model.doStream({ prompt: [] })

    await expect(collect(result.stream)).rejects.toBe(down)
    expect(fallbackBuilt).toBe(0)
  })

  it('answers provider, modelId and supportedUrls as the primary', () => {
    const model = createFallbackModel({
      primary: modelWith({ modelId: 'primary' }),
      fallback: () => modelWith({ modelId: 'fallback' }),
      onFallback: () => {},
    })

    expect(model.provider).toBe('fake')
    expect(model.modelId).toBe('primary')
    expect(model.supportedUrls).toEqual({})
  })
})
