import { AsyncLocalStorage } from 'node:async_hooks'

import {
  errorClassOf,
  NULL_SPAN_HANDLE,
  TracePort,
  type ESpan,
  type ESpanMark,
  type SpanFields,
  type SpanRequest,
} from '../trace/trace.port'

export type RecordedSpan = {
  readonly name: ESpan
  fields: SpanFields
  readonly marks: ESpanMark[]
  readonly parent: RecordedSpan | undefined
  errorClass?: string
  ended: boolean
}

export class RecordingTracer extends TracePort {
  readonly spans: RecordedSpan[] = []
  private readonly active = new AsyncLocalStorage<RecordedSpan>()

  async span<T>({ name, fields, root, run }: SpanRequest<T>): Promise<T> {
    const active = this.active.getStore()
    if (root !== true && active === undefined) return run(NULL_SPAN_HANDLE)
    const span: RecordedSpan = {
      name,
      fields: { ...fields },
      marks: [],
      parent: root === true ? undefined : active,
      ended: false,
    }
    this.spans.push(span)
    try {
      return await this.active.run(span, () =>
        run({
          set: (more) => {
            span.fields = { ...span.fields, ...more }
          },
          mark: (mark) => {
            if (!span.marks.includes(mark)) span.marks.push(mark)
          },
        }),
      )
    } catch (error) {
      span.errorClass = errorClassOf(error)
      throw error
    } finally {
      span.ended = true
    }
  }

  named(name: ESpan): RecordedSpan[] {
    return this.spans.filter((span) => span.name === name)
  }
}
