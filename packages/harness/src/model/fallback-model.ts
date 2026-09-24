import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider'

const restartableStream = (args: {
  stream: ReadableStream<LanguageModelV4StreamPart>
  restart: (fault: unknown) => Promise<ReadableStream<LanguageModelV4StreamPart>>
}): ReadableStream<LanguageModelV4StreamPart> => {
  let reader = args.stream.getReader()
  let emitted = false
  let restarted = false

  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      for (;;) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            return
          }
          emitted = true
          controller.enqueue(value)
          return
        } catch (fault) {
          if (emitted || restarted) throw fault
          restarted = true
          reader = (await args.restart(fault)).getReader()
        }
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
}

export function createFallbackModel(args: {
  primary: LanguageModelV4
  fallback: () => LanguageModelV4 | undefined
  onFallback: (fault: unknown) => void
}): LanguageModelV4 {
  const fallbackFor = (fault: unknown): LanguageModelV4 => {
    args.onFallback(fault)
    const model = args.fallback()
    if (model === undefined) throw fault
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
        return await fallbackFor(fault).doGenerate(options)
      }
    },
    doStream: async (options): Promise<LanguageModelV4StreamResult> => {
      let result: LanguageModelV4StreamResult
      try {
        result = await args.primary.doStream(options)
      } catch (fault) {
        return await fallbackFor(fault).doStream(options)
      }

      return {
        ...result,
        stream: restartableStream({
          stream: result.stream,
          restart: async (fault) => (await fallbackFor(fault).doStream(options)).stream,
        }),
      }
    },
  }
}
