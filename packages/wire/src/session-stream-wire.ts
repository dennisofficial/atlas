import { streamServerMessageSchema } from '@dltech/atlas-protocol'
import { z } from 'zod'

export const sessionStreamFollowInputSchema = z
  .strictObject({
    sessionId: z.string().min(1),
    afterSeq: z.number().int().min(0).optional(),
    afterHash: z.string().min(1).optional(),
  })
  .refine((input) => input.afterHash === undefined || input.afterSeq !== undefined, {
    message: 'afterHash requires afterSeq',
    path: ['afterHash'],
  })

export type SessionStreamFollowInput = z.infer<typeof sessionStreamFollowInputSchema>

export const sessionStreamFrameSchema = streamServerMessageSchema

export type SessionStreamFrame = z.infer<typeof sessionStreamFrameSchema>

const isAsyncIterable = (value: unknown): value is AsyncIterable<SessionStreamFrame> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'

export const sessionStreamOutputSchema =
  z.custom<AsyncIterable<SessionStreamFrame>>(isAsyncIterable)

export type SessionStreamReadyFrame = Extract<SessionStreamFrame, { type: 'ready' }>

export type SessionStreamGoingAwayFrame = Extract<SessionStreamFrame, { type: 'going-away' }>

export type SessionStreamEventsFrame = Extract<SessionStreamFrame, { type: 'events' }>

export type SessionStreamListFrame = Extract<
  SessionStreamFrame,
  { type: 'snapshot' | 'upsert' | 'remove' }
>
