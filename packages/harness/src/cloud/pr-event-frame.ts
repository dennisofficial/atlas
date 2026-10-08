import { EPrEventKind, EPrReviewState, EPrVerdict, type EventDraft } from '@dltech/atlas-core'
import { z } from 'zod'

import type { TransportRetryLog } from './cloud-transport'

const GITHUB_HOST = 'github.com'

// z.object, not strictObject: the server adds payload fields over time and a field we do not read
// must never drop the notice. Optional fields are absent when not carried, never null or empty.
const payloadSchema = z.object({
  url: z.string().min(1),
  authorLogin: z.string().optional(),
  body: z.string().optional(),
  headSha: z.string().optional(),
  reviewState: z.enum(EPrReviewState).optional(),
  verdict: z.enum(EPrVerdict).optional(),
  mergeable: z.boolean().optional(),
  state: z.string().optional(),
})

export const prEventFrameSchema = z.object({
  id: z.string().min(1),
  repoFullName: z.string().min(1),
  prNumber: z.number().int().positive(),
  kind: z.enum(EPrEventKind),
  payload: payloadSchema,
  createdAt: z.string(),
})

export type PrEventFrame = z.infer<typeof prEventFrameSchema>

export type PrEventDraft = Extract<EventDraft, { type: 'pr-event' }>

export const repoOfFrame = (frame: PrEventFrame): string => `${GITHUB_HOST}/${frame.repoFullName}`

export function prEventNoticeOf(frame: PrEventFrame): PrEventDraft {
  const { payload } = frame
  const repo = repoOfFrame(frame)

  return {
    type: 'pr-event',
    repo,
    prNumber: frame.prNumber,
    kind: frame.kind,
    url: payload.url,
    ...(payload.authorLogin === undefined ? {} : { authorLogin: payload.authorLogin }),
    ...(payload.body === undefined ? {} : { body: payload.body }),
    ...(payload.verdict === undefined ? {} : { verdict: payload.verdict }),
    ...(payload.mergeable === undefined ? {} : { mergeable: payload.mergeable }),
    ...(payload.state === undefined ? {} : { state: payload.state }),
    ...(payload.reviewState === undefined ? {} : { reviewState: payload.reviewState }),
  }
}

export function parsePrEventFrame(args: { data: string }): { frame: PrEventFrame } | { failure: string } {
  let raw: unknown
  try {
    raw = JSON.parse(args.data)
  } catch {
    return { failure: 'the frame was not JSON' }
  }

  const parsed = prEventFrameSchema.safeParse(raw)
  if (parsed.success) return { frame: parsed.data }
  return { failure: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
}

/** A bad frame or a throwing consumer is logged and dropped: one notice must never end the stream. */
export function deliverPrEvent(args: {
  data: string
  onPrEvent: ((frame: PrEventFrame) => void) | undefined
  log: TransportRetryLog | undefined
}): void {
  if (args.onPrEvent === undefined) return

  const parsed = parsePrEventFrame({ data: args.data })
  if ('failure' in parsed) {
    args.log?.port.warn({
      source: 'cloud.pull-requests',
      message: `dropped a malformed pr-event frame: ${parsed.failure}`,
    })
    return
  }

  try {
    args.onPrEvent(parsed.frame)
  } catch (failure) {
    args.log?.port.warn({
      source: 'cloud.pull-requests',
      message: `a pr-event consumer threw: ${failure instanceof Error ? failure.message : String(failure)}`,
    })
  }
}
