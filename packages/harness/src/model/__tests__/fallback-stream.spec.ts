import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'bun:test'
import { createFallbackModel } from '../fallback-model'

const PRELUDE: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'response-metadata', id: 'primary-response' },
  { type: 'text-start', id: 'primary-text' },
]
const FALLBACK: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 'fallback-text' },
  { type: 'text-delta', id: 'fallback-text', delta: 'answer' },
  { type: 'text-end', id: 'fallback-text' },
]

const modelWithStream = (args: {
  parts: LanguageModelV4StreamPart[]
  throws?: unknown
  cancelled?: (reason: unknown) => void
}): LanguageModelV4 => ({
  specificationVersion: 'v4',
  provider: 'fake',
  modelId: 'fake',
  supportedUrls: {},
  doGenerate: async () => {
    throw new Error('generation is not under test')
  },
  doStream: async () => {
    let index = 0
    return {
      stream: new ReadableStream<LanguageModelV4StreamPart>(
        {
          pull(controller) {
            const part = args.parts[index++]
            if (part !== undefined) controller.enqueue(part)
            else if (args.throws !== undefined) controller.error(args.throws)
            else controller.close()
          },
          ...(args.cancelled === undefined ? {} : { cancel: args.cancelled }),
        },
        { highWaterMark: 0 },
      ),
    }
  },
})

const collect = async (model: LanguageModelV4): Promise<LanguageModelV4StreamPart[]> => {
  const result = await model.doStream({ prompt: [] })
  return Array.fromAsync(result.stream)
}

describe('utility stream failover', () => {
  it.each(['chunk', 'throw'])(
    'retries a %s failure after metadata but before output',
    async (mode) => {
      const fault = new Error('insufficient credits')
      const faults: unknown[] = []
      const cancelled: unknown[] = []
      const model = createFallbackModel({
        primary: modelWithStream({
          parts: [
            ...PRELUDE,
            ...(mode === 'chunk' ? [{ type: 'error' as const, error: fault }] : []),
          ],
          throws: mode === 'throw' ? fault : undefined,
          cancelled: (reason) => cancelled.push(reason),
        }),
        fallback: () => modelWithStream({ parts: FALLBACK }),
        onFallback: (error) => faults.push(error),
      })

      expect(await collect(model)).toEqual(FALLBACK)
      expect(faults).toEqual([fault])
      if (mode === 'chunk') expect(cancelled).toEqual([fault])
    },
  )

  it('does not retry once reasoning or text output has flowed', async () => {
    for (const type of ['reasoning-delta', 'text-delta', 'tool-input-delta'] as const) {
      const fault = new Error('late failure')
      const parts: LanguageModelV4StreamPart[] = [
        ...PRELUDE,
        { type, id: 'one', delta: 'partial' },
        { type: 'error', error: fault },
      ]
      let fallbackCalls = 0
      const model = createFallbackModel({
        primary: modelWithStream({ parts }),
        fallback: () => {
          fallbackCalls++
          return modelWithStream({ parts: FALLBACK })
        },
        onFallback: () => {},
      })

      expect(await collect(model)).toEqual(parts)
      expect(fallbackCalls).toBe(0)
    }
  })

  it('preserves the primary prelude when no failure occurs', async () => {
    const parts = [...PRELUDE, { type: 'text-delta' as const, id: 'primary-text', delta: 'answer' }]
    const model = createFallbackModel({
      primary: modelWithStream({ parts }),
      fallback: () => undefined,
      onFallback: () => {
        throw new Error('no fallback expected')
      },
    })
    expect(await collect(model)).toEqual(parts)
  })

  it('tries only once and preserves a fallback error part', async () => {
    const fault = new Error('fallback is down too')
    let attempts = 0
    const model = createFallbackModel({
      primary: modelWithStream({ parts: [{ type: 'error', error: new Error('down') }] }),
      fallback: () => {
        attempts++
        return modelWithStream({ parts: [{ type: 'error', error: fault }] })
      },
      onFallback: () => {},
    })
    expect(await collect(model)).toEqual([{ type: 'error', error: fault }])
    expect(attempts).toBe(1)
  })

  it('does not announce an unavailable fallback', async () => {
    const fault = new Error('down')
    let notices = 0
    const model = createFallbackModel({
      primary: modelWithStream({ parts: [{ type: 'error', error: fault }] }),
      fallback: () => undefined,
      onFallback: () => {
        notices++
      },
    })
    await expect(collect(model)).rejects.toBe(fault)
    expect(notices).toBe(0)
  })

  it('does not retry a caller-aborted generation', async () => {
    const controller = new AbortController()
    const fault = new Error('aborted')
    let attempts = 0
    const model = createFallbackModel({
      primary: {
        ...modelWithStream({ parts: [] }),
        doGenerate: async () => {
          controller.abort()
          throw fault
        },
      },
      fallback: () => {
        attempts++
        return modelWithStream({ parts: [] })
      },
      onFallback: () => {},
    })
    await expect(model.doGenerate({ prompt: [], abortSignal: controller.signal })).rejects.toBe(
      fault,
    )
    expect(attempts).toBe(0)
  })

  it('forwards cancellation to the active fallback reader', async () => {
    const reasons: unknown[] = []
    const model = createFallbackModel({
      primary: modelWithStream({ parts: [{ type: 'error', error: new Error('down') }] }),
      fallback: () =>
        modelWithStream({ parts: FALLBACK, cancelled: (reason) => reasons.push(reason) }),
      onFallback: () => {},
    })
    const result = await model.doStream({ prompt: [] })
    const reader = result.stream.getReader()
    await reader.read()
    await reader.cancel('operator interrupted')
    expect(reasons).toEqual(['operator interrupted'])
  })
})
