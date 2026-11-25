import { httpStatusOf } from '@dltech/atlas-api-router'
import { answerRefusalOf } from '@dltech/atlas-plugin-operator/client'

export type OperatorAnswerBody =
  | { sessionId: string; callId: string; value: string }
  | { sessionId: string; callId: string; cancel: true }

export type OperatorAnswerApi = {
  operatorRequests: {
    answer: {
      mutate(body: OperatorAnswerBody): Promise<unknown>
    }
  }
}

export type OperatorAnswerResult = { ok: true } | { ok: false; reason: string }

export const answerOperatorRequest = async (args: {
  api: OperatorAnswerApi
  body: OperatorAnswerBody
}): Promise<OperatorAnswerResult> => {
  try {
    await args.api.operatorRequests.answer.mutate(args.body)
    return { ok: true }
  } catch (failure) {
    return { ok: false, reason: answerRefusalOf({ status: httpStatusOf(failure) }) }
  }
}
