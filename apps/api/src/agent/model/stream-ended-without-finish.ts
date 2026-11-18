import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'

export class StreamEndedWithoutFinish extends Error {
  constructor() {
    super('the model stream ended without a finish part')
    this.name = 'StreamEndedWithoutFinish'
  }
}

export function requireFinish(args: {
  stream: ReadableStream<LanguageModelV4StreamPart>
  signal: AbortSignal | undefined
}): ReadableStream<LanguageModelV4StreamPart> {
  let finished = false
  return args.stream.pipeThrough(
    new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      transform(part, controller) {
        if (part.type === 'finish') finished = true
        controller.enqueue(part)
      },
      flush(controller) {
        if (!finished && args.signal?.aborted !== true)
          controller.error(new StreamEndedWithoutFinish())
      },
    }),
  )
}
