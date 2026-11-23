import {
  ModelPort,
  requestHashesOf,
  requestSizeOf,
  type ChunkFilter,
  type ChunkType,
  type ModelStepResult,
  type ModelTraits,
} from '@dltech/atlas-core'
import {
  ESpan,
  ESpanMark,
  ESpanSpeed,
  type SpanFields,
  type SpanHandle,
  type TracePort,
} from '@dltech/atlas-observability'

import type { FirstTokenClock } from './first-token'

const REASONING_CHUNKS: ReadonlySet<ChunkType> = new Set(['reasoning-start', 'reasoning-delta'])
const OUTPUT_CHUNKS: ReadonlySet<ChunkType> = new Set([
  'text-start',
  'text-delta',
  'tool-input-start',
  'tool-call',
])

const markingFilter =
  ({
    span,
    inner,
    firstToken,
  }: {
    span: SpanHandle
    inner: ChunkFilter | undefined
    firstToken: FirstTokenClock | undefined
  }): ChunkFilter =>
  (chunk) => {
    span.mark(ESpanMark.FirstChunk)
    firstToken?.firstChunk()
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
  speed: result.ranFast === true ? ESpanSpeed.Fast : ESpanSpeed.Standard,
})

export class TracedModel extends ModelPort {
  private readonly inner: ModelPort
  private readonly trace: TracePort
  private readonly firstToken: FirstTokenClock | undefined

  constructor(args: {
    inner: ModelPort
    trace: TracePort
    firstToken?: FirstTokenClock | undefined
  }) {
    super()
    this.inner = args.inner
    this.trace = args.trace
    this.firstToken = args.firstToken
  }

  get identity(): ModelPort['identity'] {
    return this.inner.identity
  }

  override traits(): ModelTraits {
    return this.inner.traits?.() ?? {}
  }

  step(args: Parameters<ModelPort['step']>[0]): Promise<ModelStepResult> {
    const { id, modelId } = this.inner.identity
    const firstCall = this.firstToken?.claimsFirstCall() === true
    return this.trace.span({
      name: ESpan.ModelCall,
      fields: {
        provider: id,
        model: modelId,
        auth: this.inner.traits?.().auth,
        sizes: requestSizeOf({ assembled: args.assembled, tools: args.tools }),
        hashes: requestHashesOf({ assembled: args.assembled, tools: args.tools }),
      },
      run: async (span) => {
        const result = await this.inner.step({
          ...args,
          onChunk: markingFilter({
            span,
            inner: args.onChunk,
            firstToken: firstCall ? this.firstToken : undefined,
          }),
        })
        span.set(resultFieldsOf(result))
        return result
      },
    })
  }
}
