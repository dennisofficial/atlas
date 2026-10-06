import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'

const beginsOutput = (part: LanguageModelV4StreamPart): boolean => {
  switch (part.type) {
    case 'stream-start':
    case 'response-metadata':
    case 'text-start':
    case 'text-end':
    case 'reasoning-start':
    case 'reasoning-end':
    case 'tool-input-start':
    case 'tool-input-end':
    case 'raw':
      return false
    case 'text-delta':
    case 'reasoning-delta':
    case 'tool-input-delta':
      return part.delta.length > 0
    default:
      return true
  }
}

const restartableStream = (args: {
  stream: ReadableStream<LanguageModelV4StreamPart>
  restart: (fault: unknown) => Promise<ReadableStream<LanguageModelV4StreamPart>>
  signal?: AbortSignal | undefined
}): ReadableStream<LanguageModelV4StreamPart> => {
  const primaryReader = args.stream.getReader()
  let reader: typeof primaryReader | undefined = primaryReader
  let cancelled = false
  let cancellationReason: unknown
  let emitted = false
  let restarted = false
  const prelude: LanguageModelV4StreamPart[] = []

  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      for (;;) {
        const activeReader = reader
        if (activeReader === undefined || cancelled) return
        try {
          const { done, value } = await activeReader.read()
          if (cancelled) return
          if (done) {
            for (const part of prelude) controller.enqueue(part)
            prelude.length = 0
            reader = undefined
            activeReader.releaseLock()
            controller.close()
            return
          }
          if (!emitted && !restarted && value.type === 'error') throw value.error
          if (!emitted && !beginsOutput(value)) {
            prelude.push(value)
            continue
          }
          emitted = true
          for (const part of prelude) controller.enqueue(part)
          prelude.length = 0
          controller.enqueue(value)
          return
        } catch (fault) {
          if (cancelled) return
          reader = undefined
          if (emitted || restarted || args.signal?.aborted) {
            activeReader.releaseLock()
            throw fault
          }
          restarted = true
          await activeReader.cancel(fault).catch(() => {})
          activeReader.releaseLock()
          prelude.length = 0
          if (cancelled) return
          const stream = await args.restart(fault)
          if (cancelled) {
            await stream.cancel(cancellationReason)
            return
          }
          reader = stream.getReader()
        }
      }
    },
    cancel: (reason) => {
      cancelled = true
      cancellationReason = reason
      const activeReader = reader
      reader = undefined
      return activeReader?.cancel(reason).finally(() => activeReader.releaseLock())
    },
  })
}

export function createFallbackModel(args: {
  primary: LanguageModelV4
  fallback: () => LanguageModelV4 | undefined
  onFallback: (fault: unknown) => void
}): LanguageModelV4 {
  const fallbackFor = (options: {
    fault: unknown
    signal?: AbortSignal | undefined
  }): LanguageModelV4 => {
    if (options.signal?.aborted) throw options.fault
    const model = args.fallback()
    if (model === undefined) throw options.fault
    args.onFallback(options.fault)
    return model
  }

  return {
    specificationVersion: 'v4',
    get provider() {
      return args.primary.provider
    },
    get modelId() {
      return args.primary.modelId
    },
    get supportedUrls() {
      return args.primary.supportedUrls
    },
    doGenerate: async (options) => {
      try {
        return await args.primary.doGenerate(options)
      } catch (fault) {
        return await fallbackFor({ fault, signal: options.abortSignal }).doGenerate(options)
      }
    },
    doStream: async (options): Promise<LanguageModelV4StreamResult> => {
      let result: LanguageModelV4StreamResult
      try {
        result = await args.primary.doStream(options)
      } catch (fault) {
        return await fallbackFor({ fault, signal: options.abortSignal }).doStream(options)
      }

      return {
        ...result,
        stream: restartableStream({
          stream: result.stream,
          signal: options.abortSignal,
          restart: async (fault) =>
            (await fallbackFor({ fault, signal: options.abortSignal }).doStream(options)).stream,
        }),
      }
    },
  }
}
