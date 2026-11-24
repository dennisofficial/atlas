import { httpStatusOf } from '@dltech/atlas-api-router'
import { answerRefusalOf } from '@dltech/atlas-plugin-operator/client'

import { api } from '@/lib/api-client'

export type OperatorAnswerResult = { ok: true } | { ok: false; reason: string }

export type OperatorAnswerKey = { sessionId: string; callId: string }

export type AnswerOperatorRequestArgs = OperatorAnswerKey & { value: string }

export type CancelOperatorRequestArgs = OperatorAnswerKey

type AnswerBody = (OperatorAnswerKey & { value: string }) | (OperatorAnswerKey & { cancel: true })

const answerOf = async (body: AnswerBody): Promise<OperatorAnswerResult> => {
  try {
    await api.operatorRequests.answer.mutate(body)
    return { ok: true }
  } catch (failure) {
    return { ok: false, reason: answerRefusalOf({ status: httpStatusOf(failure) }) }
  }
}

export async function answerOperatorRequest(
  args: AnswerOperatorRequestArgs,
): Promise<OperatorAnswerResult> {
  return answerOf({ sessionId: args.sessionId, callId: args.callId, value: args.value })
}

export async function cancelOperatorRequest(
  args: CancelOperatorRequestArgs,
): Promise<OperatorAnswerResult> {
  return answerOf({ sessionId: args.sessionId, callId: args.callId, cancel: true })
}
