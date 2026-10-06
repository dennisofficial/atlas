import type { LanguageModelV4StreamPart, LanguageModelV4StreamResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'bun:test'
import { createFallbackModel } from '../fallback-model'
import { createNotifyingModel } from '../notifying-model'

describe('model stream cancellation', () => {
  it('cancels a fallback that opens after its consumer has stopped', async () => {
    const opening = Promise.withResolvers<void>()
    const release = Promise.withResolvers<LanguageModelV4StreamResult>()
    const cancelled: unknown[] = []
    const model = createFallbackModel({
      primary: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: 'error', error: new Error('down') })
            },
          }),
        }),
      }),
      fallback: () =>
        new MockLanguageModelV4({
          doStream: async () => {
            opening.resolve()
            return release.promise
          },
        }),
      onFallback: () => {},
    })
    const result = await model.doStream({ prompt: [] })
    const reader = result.stream.getReader()
    const reading = reader.read()
    await opening.promise
    await expect(reader.cancel('operator stopped')).resolves.toBeUndefined()
    release.resolve({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        cancel: (reason) => {
          cancelled.push(reason)
        },
      }),
    })
    await reading
    await Bun.sleep(0)
    expect(cancelled).toEqual(['operator stopped'])
  })

  it('does not report consumer cancellation as a provider failure', async () => {
    const entered = Promise.withResolvers<void>()
    const faults: unknown[] = []
    const model = createNotifyingModel({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            pull() {
              entered.resolve()
            },
          }),
        }),
      }),
      onFault: (fault) => faults.push(fault),
    })
    const result = await model.doStream({ prompt: [] })
    const reader = result.stream.getReader()
    const reading = reader.read()
    await entered.promise
    await reader.cancel('operator stopped')
    await reading
    await Bun.sleep(0)
    expect(faults).toEqual([])
  })
})
