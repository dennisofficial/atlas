import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider'

export type ModelFault = {
  providerId: string
  modelId: string
  fault: unknown
}

function notifyingStream(args: {
  stream: ReadableStream<LanguageModelV4StreamPart>
  report: (fault: unknown) => void
}): ReadableStream<LanguageModelV4StreamPart> {
  const reader = args.stream.getReader()
  let reported = false
  let cancelled = false
  const reportOnce = (fault: unknown): void => {
    if (reported) return
    reported = true
    args.report(fault)
  }

  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (cancelled) return
        if (done) {
          reader.releaseLock()
          controller.close()
          return
        }
        if (value.type === 'error') reportOnce(value.error)
        controller.enqueue(value)
      } catch (fault) {
        if (cancelled) return
        reportOnce(fault)
        reader.releaseLock()
        throw fault
      }
    },
    cancel: (reason) => {
      cancelled = true
      return reader.cancel(reason).finally(() => reader.releaseLock())
    },
  })
}

export function createNotifyingModel(args: {
  model: LanguageModelV4
  onFault: (fault: ModelFault) => void
}): LanguageModelV4 {
  const report = (fault: unknown): void => {
    try {
      args.onFault({ providerId: args.model.provider, modelId: args.model.modelId, fault })
    } catch {
      return
    }
  }

  return {
    specificationVersion: 'v4',
    get provider() {
      return args.model.provider
    },
    get modelId() {
      return args.model.modelId
    },
    get supportedUrls() {
      return args.model.supportedUrls
    },
    doGenerate: async (options) => {
      try {
        return await args.model.doGenerate(options)
      } catch (fault) {
        report(fault)
        throw fault
      }
    },
    doStream: async (options) => {
      try {
        const result = await args.model.doStream(options)
        return { ...result, stream: notifyingStream({ stream: result.stream, report }) }
      } catch (fault) {
        report(fault)
        throw fault
      }
    },
  }
}
