import type { SpanHandle, TracePort } from '@dltech/atlas-observability'
import { ESpan, spanWith } from '@dltech/atlas-observability'

import { clientToApiMsOf } from './prompt-post-latency'

export type PromptPostSpan = {
  delivered(posted: { inboxId: number; hasMedia: boolean }): void
}

export const withPromptPostSpan = <T>(args: {
  trace: TracePort | undefined
  sessionId: string
  sentAt: string | undefined
  serverNow: number
  run: (post: PromptPostSpan) => Promise<T>
}): Promise<T> =>
  spanWith(args.trace, {
    name: ESpan.PromptPost,
    root: true,
    fields: { sessionId: args.sessionId },
    run: (span) => args.run(postSpanOf({ span, sentAt: args.sentAt, serverNow: args.serverNow })),
  })

const postSpanOf = (args: {
  span: SpanHandle
  sentAt: string | undefined
  serverNow: number
}): PromptPostSpan => ({
  delivered: ({ inboxId, hasMedia }) => {
    const clientToApiMs = clientToApiMsOf({ sentAt: args.sentAt, serverNow: args.serverNow })
    args.span.set({ inboxId, hasMedia, ...(clientToApiMs === undefined ? {} : { clientToApiMs }) })
  },
})
