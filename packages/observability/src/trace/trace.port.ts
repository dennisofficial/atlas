import type { CallId, RunId, ThreadId } from '@dltech/atlas-core'
import type { EAuthKind } from '@dltech/atlas-core'

export enum ESpan {
  Turn = 'turn',
  TurnHooks = 'turn.hooks',
  Hook = 'hook',
  ContextPrepare = 'context.prepare',
  ModelCall = 'model.call',
  ModelResolve = 'model.resolve',
  ModelBackoff = 'model.backoff',
  StepIntake = 'step.intake',
  LoopWatch = 'loop.watch',
  RecordAppend = 'record.append',
  Tool = 'tool',
  ToolHooks = 'tool.hooks',
  ToolInvoke = 'tool.invoke',
  ToolAfterHooks = 'tool.after-hooks',
  PromptPost = 'prompt.post',
  Takeover = 'holder.takeover',
  ResourceStatus = 'resource.status',
  ResourceVersions = 'resource.versions',
  ResourceArm = 'resource.arm',
  ResourceLoad = 'resource.load',
  ResourceAppend = 'resource.append',
}

export enum ESpanMark {
  FirstChunk = 'first_chunk',
  FirstReasoning = 'first_reasoning',
  FirstOutput = 'first_output',
}

export enum ETurnEntry {
  Start = 'start',
  Resume = 'resume',
}

export enum EWake {
  Warm = 'warm',
  Cold = 'cold',
}

export enum ESpanSpeed {
  Fast = 'fast',
  Standard = 'standard',
}

export enum ESpanOutcome {
  Ok = 'ok',
  Error = 'error',
  Denied = 'denied',
  Handoff = 'handoff',
}

/** Names, ids and counts only: nothing a user or a model wrote can be attached to a span. */
export type SpanFields = {
  readonly threadId?: ThreadId | undefined
  readonly sessionId?: string | undefined
  readonly inboxId?: number | undefined
  readonly hasMedia?: boolean | undefined
  readonly runId?: RunId | undefined
  readonly callId?: CallId | undefined
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly auth?: EAuthKind | undefined
  readonly tool?: string | undefined
  readonly hook?: string | undefined
  readonly resource?: string | undefined
  readonly phase?: string | undefined
  readonly status?: string | undefined
  readonly failureKind?: string | undefined
  readonly verdict?: string | undefined
  readonly finishReason?: string | undefined
  readonly outcome?: ESpanOutcome | undefined
  readonly entry?: ETurnEntry | undefined
  readonly wake?: EWake | undefined
  readonly queuedMs?: number | undefined
  readonly firstTokenMs?: number | undefined
  readonly clientToApiMs?: number | undefined
  readonly speed?: ESpanSpeed | undefined
  readonly step?: number | undefined
  readonly delayMs?: number | undefined
  readonly drafts?: number | undefined
  readonly events?: number | undefined
  readonly toolCalls?: number | undefined
  readonly inputTokens?: number | undefined
  readonly outputTokens?: number | undefined
  readonly cacheReadTokens?: number | undefined
  readonly cacheWriteTokens?: number | undefined
  readonly sizes?: Readonly<Record<string, number>> | undefined
  readonly hashes?: Readonly<Record<string, string>> | undefined
  readonly timings?: Readonly<Record<string, number>> | undefined
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

const SIZE_ATTRIBUTE_PREFIX = 'size.'
const HASH_ATTRIBUTE_PREFIX = 'hash.'
const TIMING_ATTRIBUTE_SUFFIX = 'Ms'

const prefixed = <T>(args: {
  prefix: string
  values: Readonly<Record<string, T>> | undefined
}): Record<string, T> =>
  Object.fromEntries(
    Object.entries(args.values ?? {}).map(([key, value]) => [`${args.prefix}${key}`, value]),
  )

const suffixed = (args: {
  suffix: string
  values: Readonly<Record<string, number>> | undefined
}): Record<string, number> =>
  Object.fromEntries(
    Object.entries(args.values ?? {}).map(([key, value]) => [`${key}${args.suffix}`, value]),
  )

export const spanAttributesOf = (
  fields: SpanFields | undefined,
): Record<string, string | number | boolean> => {
  if (fields === undefined) return {}
  const { sizes, hashes, timings, ...rest } = fields
  return {
    ...Object.fromEntries(
      Object.entries(rest).filter(
        (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
      ),
    ),
    ...suffixed({ suffix: TIMING_ATTRIBUTE_SUFFIX, values: timings }),
    ...prefixed({ prefix: SIZE_ATTRIBUTE_PREFIX, values: sizes }),
    ...prefixed({ prefix: HASH_ATTRIBUTE_PREFIX, values: hashes }),
  }
}
