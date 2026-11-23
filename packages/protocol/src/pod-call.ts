import { z } from 'zod'

import { daemonEventFrameSchema } from './frames'
import { ELiveOpFailure } from './live-op'
import { callOpSchema, callResultSchema } from './ops'

export const POD_CALL_REQUEST_CHANNEL = 'atlas_pod_call'

export const POD_READY_CHANNEL = 'atlas_pod_ready'

export const POD_STREAM_TTL_MS = 30_000

export const POD_STREAM_RENEW_EVERY_MS = 10_000

export const podCallReplyChannel = (requesterId: string): string =>
  `atlas:pod-call-reply:${requesterId}`

export const podStreamChannel = (streamId: string): string => `atlas:pod-stream:${streamId}`

export enum EPodCallKind {
  Invoke = 'invoke',
  Follow = 'follow',
  Renew = 'renew',
  Release = 'release',
}

const addressShape = {
  requestId: z.string().min(1),
  replyTo: z.string().min(1),
  sessionId: z.string().min(1),
  targetHostId: z.number().int(),
}

const streamShape = {
  ...addressShape,
  streamId: z.string().min(1),
}

export const podCallRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...addressShape, kind: z.literal(EPodCallKind.Invoke), op: callOpSchema }),
  z.strictObject({
    ...streamShape,
    kind: z.literal(EPodCallKind.Follow),
    ttlMs: z.number().int().positive(),
  }),
  z.strictObject({
    ...streamShape,
    kind: z.literal(EPodCallKind.Renew),
    ttlMs: z.number().int().positive(),
  }),
  z.strictObject({ ...streamShape, kind: z.literal(EPodCallKind.Release) }),
])

export type PodCallRequest = z.infer<typeof podCallRequestSchema>

export const podCallReplyOutcomeSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('ok'), result: callResultSchema }),
  z.strictObject({ state: z.literal('open') }),
  z.strictObject({
    state: z.literal('unavailable'),
    reason: z.enum([ELiveOpFailure.Asleep, ELiveOpFailure.Absent]),
  }),
  z.strictObject({ state: z.literal('failed'), message: z.string() }),
])

export type PodCallReplyOutcome = z.infer<typeof podCallReplyOutcomeSchema>

export const podCallReplySchema = z.strictObject({
  requestId: z.string().min(1),
  outcome: podCallReplyOutcomeSchema,
})

export type PodCallReply = z.infer<typeof podCallReplySchema>

export const podStreamCloseReasonSchema = z.enum(['asleep', 'restarted', 'detached'])

export type PodStreamCloseReason = z.infer<typeof podStreamCloseReasonSchema>

export const podStreamFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('event'), frame: daemonEventFrameSchema }),
  z.strictObject({ type: z.literal('closed'), reason: podStreamCloseReasonSchema }),
])

export type PodStreamFrame = z.infer<typeof podStreamFrameSchema>

export const podReadySchema = z.strictObject({
  sessionId: z.string().min(1),
  hostId: z.number().int(),
})

export type PodReady = z.infer<typeof podReadySchema>
