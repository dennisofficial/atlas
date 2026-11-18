import type { LogPort } from '@dltech/atlas-observability'
import { z } from 'zod'

import type { OperatorRequestOutcome, OperatorRequestRegistry } from './registry'

export const OPERATOR_ANSWER_PATH = '/operator-requests/answer'

export const MAX_VALUE_LENGTH = 64 * 1024

const answerBodySchema = z.strictObject({
  sessionId: z.string().min(1),
  callId: z.string().min(1),
  value: z.string().max(MAX_VALUE_LENGTH),
})

const cancelBodySchema = z.strictObject({
  sessionId: z.string().min(1),
  callId: z.string().min(1),
  cancel: z.literal(true),
})

export const operatorAnswerRequestSchema = z.union([answerBodySchema, cancelBodySchema])

export type OperatorAnswerRequest = z.infer<typeof operatorAnswerRequestSchema>

export type OperatorAnswer = { status: number; body: unknown }

export type OperatorAnswerServiceArgs = {
  registry: OperatorRequestRegistry
  log?: LogPort | undefined
}

const answerOf = (args: {
  outcome: OperatorRequestOutcome
  log: LogPort | undefined
}): OperatorAnswer => {
  if (args.outcome.ok) return { status: 200, body: {} }
  args.log?.info({
    source: 'operator.answer',
    message: 'an operator answer was refused',
    data: { status: args.outcome.status, reason: args.outcome.reason },
  })
  return { status: args.outcome.status, body: { reason: args.outcome.reason } }
}

export class OperatorAnswerService {
  constructor(private readonly args: OperatorAnswerServiceArgs) {}

  async answer(input: { userId: string; body: OperatorAnswerRequest }): Promise<OperatorAnswer> {
    const body = input.body
    const outcome =
      'cancel' in body
        ? await this.args.registry.cancel({
            sessionId: body.sessionId,
            callId: body.callId,
            userId: input.userId,
          })
        : await this.args.registry.answer({
            sessionId: body.sessionId,
            callId: body.callId,
            userId: input.userId,
            value: body.value,
          })
    return answerOf({ outcome, log: this.args.log })
  }
}
