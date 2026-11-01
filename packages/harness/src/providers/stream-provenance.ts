import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'

import { attachProvenance, type RequestProvenance } from '../model/failure-provenance'

export function withStreamProvenance<
  TResult extends { stream: ReadableStream<LanguageModelV4StreamPart> },
>(args: { result: TResult; provenance: RequestProvenance }): TResult {
  const tagged = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
    transform(part, controller) {
      if (part.type === 'error')
        attachProvenance({ error: part.error, provenance: args.provenance })
      controller.enqueue(part)
    },
  })
  return { ...args.result, stream: args.result.stream.pipeThrough(tagged) }
}
