import { z } from 'zod'

export const MAX_OPERATOR_ANSWER_LENGTH = 64 * 1024

const keySchema = {
  sessionId: z.string().min(1),
  callId: z.string().min(1),
}

export const operatorAnswerInputSchema = z.union([
  z.strictObject({
    ...keySchema,
    value: z.string().max(MAX_OPERATOR_ANSWER_LENGTH),
  }),
  z.strictObject({ ...keySchema, cancel: z.literal(true) }),
])
export type OperatorAnswerInput = z.infer<typeof operatorAnswerInputSchema>
