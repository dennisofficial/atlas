import { httpStatusOf } from '@dltech/atlas-api-router'

import { api } from '@/lib/api-client'

export type OperatorAnswerResult = { ok: true } | { ok: false; reason: string }

export type OperatorAnswerKey = { sessionId: string; callId: string }

export type AnswerOperatorRequestArgs = OperatorAnswerKey & { value: string }

export type CancelOperatorRequestArgs = OperatorAnswerKey

type AnswerBody = (OperatorAnswerKey & { value: string }) | (OperatorAnswerKey & { cancel: true })

const UNREACHABLE = 'the agent host could not be reached'
const NOT_SIGNED_IN = 'this session is not signed in'
const SESSION_UNKNOWN = 'this session is unknown to the agent host'
const REFUSED = 'the agent host refused the answer'

const reasonOf = ({ status }: { status: number }): string => {
  if (status === 401) return NOT_SIGNED_IN
  if (status === 404) return `${SESSION_UNKNOWN} (${status})`
  return `${REFUSED} (${status})`
}

const answerOf = async (body: AnswerBody): Promise<OperatorAnswerResult> => {
  try {
    await api.operatorRequests.answer.mutate(body)
    return { ok: true }
  } catch (failure) {
    const status = httpStatusOf(failure)
    return { ok: false, reason: status === undefined ? UNREACHABLE : reasonOf({ status }) }
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
