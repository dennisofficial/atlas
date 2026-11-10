import {
  ModelPort,
  type ChunkFilter,
  type ChunkType,
  type ModelStepResult,
  type ModelTraits,
} from '@dltech/atlas-core'
import {
  ESpan,
  ESpanMark,
  type SpanFields,
  type SpanHandle,
  type TracePort,
} from '@dltech/atlas-observability'

const REASONING_CHUNKS: ReadonlySet<ChunkType> = new Set(['reasoning-start', 'reasoning-delta'])
const OUTPUT_CHUNKS: ReadonlySet<ChunkType> = new Set([
  'text-start',
  'text-delta',
  'tool-input-start',
  'tool-call',
])

const markingFilter =
  ({ span, inner }: { span: SpanHandle; inner: ChunkFilter | undefined }): ChunkFilter =>
  (chunk) => {
    span.mark(ESpanMark.FirstChunk)
    if (REASONING_CHUNKS.has(chunk.type)) span.mark(ESpanMark.FirstReasoning)
    if (OUTPUT_CHUNKS.has(chunk.type)) span.mark(ESpanMark.FirstOutput)
    return inner === undefined ? chunk : inner(chunk)
  }

const resultFieldsOf = (result: ModelStepResult): SpanFields => ({
  finishReason: result.finishReason,
  toolCalls: result.toolCalls.length,
  inputTokens: result.usage?.inputTokens,
  outputTokens: result.usage?.outputTokens,
  cacheReadTokens: result.usage?.cacheReadTokens,
  cacheWriteTokens: result.usage?.cacheWriteTokens,
})

export class TracedModel extends ModelPort {
  private readonly inner: ModelPort
  private readonly trace: TracePort

  constructor(args: { inner: ModelPort; trace: TracePort }) {
    super()
    this.inner = args.inner
    this.trace = args.trace
  }

  get identity(): ModelPort['identity'] {
    return this.inner.identity
  }

  override traits(): ModelTraits {
    return this.inner.traits?.() ?? {}
  }

  step(args: Parameters<ModelPort['step']>[0]): Promise<ModelStepResult> {
    const { id, modelId } = this.inner.identity
    return this.trace.span({
      name: ESpan.ModelCall,
      fields: { provider: id, model: modelId },
      run: async (span) => {
        const result = await this.inner.step({
          ...args,
          onChunk: markingFilter({ span, inner: args.onChunk }),
        })
        span.set(resultFieldsOf(result))
        return result
      },
    })
  }
}
