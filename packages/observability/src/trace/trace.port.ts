import type { CallId, RunId, ThreadId } from '@dltech/atlas-core'

export enum ESpan {
  Turn = 'turn',
  TurnHooks = 'turn.hooks',
  ContextPrepare = 'context.prepare',
  ModelCall = 'model.call',
  ModelBackoff = 'model.backoff',
  StepIntake = 'step.intake',
  LoopWatch = 'loop.watch',
  RecordAppend = 'record.append',
  RecordRead = 'record.read',
  Tool = 'tool',
  ToolHooks = 'tool.hooks',
  ToolInvoke = 'tool.invoke',
  ToolQuality = 'tool.quality',
  ToolAfterHooks = 'tool.after-hooks',
}

export enum ESpanMark {
  FirstChunk = 'first_chunk',
  FirstReasoning = 'first_reasoning',
  FirstOutput = 'first_output',
}

export enum ESpanOutcome {
  Ok = 'ok',
  Error = 'error',
  Denied = 'denied',
}

/** Names, ids and counts only: nothing a user or a model wrote can be attached to a span. */
export type SpanFields = {
  readonly threadId?: ThreadId | undefined
  readonly runId?: RunId | undefined
  readonly callId?: CallId | undefined
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly tool?: string | undefined
  readonly status?: string | undefined
  readonly verdict?: string | undefined
  readonly finishReason?: string | undefined
  readonly outcome?: ESpanOutcome | undefined
  readonly step?: number | undefined
  readonly delayMs?: number | undefined
  readonly drafts?: number | undefined
  readonly events?: number | undefined
  readonly toolCalls?: number | undefined
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
  readonly cacheReadTokens?: number | undefined
  readonly cacheWriteTokens?: number | undefined
}

export type SpanHandle = {
  set(fields: SpanFields): void
  mark(mark: ESpanMark): void
}

export type SpanRequest<T> = {
  name: ESpan
  fields?: SpanFields | undefined
  root?: boolean | undefined
  run: (span: SpanHandle) => Promise<T>
}

/**
 * Times one unit of work. The active span follows the async call chain, so `run` nests what it
 * starts. A root span always opens a fresh trace; any other span outside a trace is not recorded.
 */
export abstract class TracePort {
  abstract span<T>(request: SpanRequest<T>): Promise<T>
}

export const NULL_SPAN_HANDLE: SpanHandle = { set: () => {}, mark: () => {} }

export class NullTracer extends TracePort {
  span<T>({ run }: SpanRequest<T>): Promise<T> {
    return run(NULL_SPAN_HANDLE)
  }
}

export const spanWith = <T>(trace: TracePort | undefined, request: SpanRequest<T>): Promise<T> =>
  trace === undefined ? request.run(NULL_SPAN_HANDLE) : trace.span(request)

export const errorClassOf = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error

export const markAttributeOf = (mark: ESpanMark): string => `${mark}_ms`

export const spanAttributesOf = (fields: SpanFields | undefined): Record<string, string | number> =>
  Object.fromEntries(
    Object.entries(fields ?? {}).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    ),
  )
