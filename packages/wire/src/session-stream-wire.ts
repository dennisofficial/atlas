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

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'

export const sessionStreamOutputSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable)
