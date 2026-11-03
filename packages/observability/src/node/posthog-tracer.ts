import { AsyncLocalStorage } from 'node:async_hooks'

import type { PostHog, Span } from 'posthog-node'

import {
  errorClassOf,
  markAttributeOf,
  NULL_SPAN_HANDLE,
  spanAttributesOf,
  TracePort,
  type ESpanMark,
  type SpanHandle,
  type SpanRequest,
} from '../trace/trace.port'

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }

const POSTHOG_DISTINCT_ID_ATTRIBUTE = 'posthogDistinctId'

const OUTSIDE_EVERY_TRACE = AsyncLocalStorage.snapshot()

const quietly = (write: () => void): void => {
  try {
    write()
  } catch {}
}

const settle = async <T>(args: {
  request: SpanRequest<T>
  handle: SpanHandle
  onError: (error: unknown) => void
}): Promise<Settled<T>> => {
  try {
    return { ok: true, value: await args.request.run(args.handle) }
  } catch (error) {
    quietly(() => args.onError(error))
    return { ok: false, error }
  }
}

const handleOf = (span: Span): SpanHandle => {
  const startedAt = performance.now()
  const marked = new Set<ESpanMark>()
  return {
    set: (fields) => quietly(() => span.setAttributes(spanAttributesOf(fields))),
    mark: (mark) => {
      if (marked.has(mark)) return
      marked.add(mark)
      quietly(() => {
        span.addEvent(mark)
        span.setAttribute(markAttributeOf(mark), Math.round(performance.now() - startedAt))
      })
    },
  }
}

/**
 * Exports through posthog-node's tracing (`withSpan`). A failing `run` is settled inside the
 * callback, because withSpan's own error path records the exception message, which can quote a
 * path or a command (https://posthog.com/docs/libraries/node#distributed-tracing).
 */
export class PosthogTracer extends TracePort {
  private readonly client: PostHog
  private readonly distinctId: string

  constructor(args: { client: PostHog; distinctId: string }) {
    super()
    this.client = args.client
    this.distinctId = args.distinctId
  }

  span<T>(request: SpanRequest<T>): Promise<T> {
    if (request.root === true) return OUTSIDE_EVERY_TRACE(() => this.exported(request))
    if (this.client.getActiveSpan() === null) return request.run(NULL_SPAN_HANDLE)
    return this.exported(request)
  }

  private async exported<T>(request: SpanRequest<T>): Promise<T> {
    let held: Promise<Settled<T>> | undefined
    try {
      await this.client.withSpan(
        request.name,
        {
          attributes: {
            ...spanAttributesOf(request.fields),
            [POSTHOG_DISTINCT_ID_ATTRIBUTE]: this.distinctId,
          },
        },
        (span) => {
          held = settle({
            request,
            handle: handleOf(span),
            onError: (error) => {
              span.setStatus('error')
              span.setAttribute('error.class', errorClassOf(error))
            },
          })
          return held
        },
      )
    } catch {}
    const settled = await (held ?? settle({ request, handle: NULL_SPAN_HANDLE, onError: () => {} }))
    if (!settled.ok) throw settled.error
    return settled.value
  }
}
