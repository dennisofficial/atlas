import { fetchStreamToken } from '@/features/sessions/data/stream-token'
import { hostOrigin } from '@/lib/host-url'

export type OperatorAnswerResult = { ok: true } | { ok: false; reason: string }

export type AnswerOperatorRequestArgs = {
  requestId: string
  value: string
}

export type CancelOperatorRequestArgs = { requestId: string }

type AnswerBody = { requestId: string; value: string } | { requestId: string; cancel: true }

const UNREACHABLE = 'the agent host could not be reached'
const NOT_SIGNED_IN = 'this session is not signed in'
const REFUSED = 'the agent host refused the answer'

const REFUSAL_SENTENCES: Record<string, string> = {
  bearer: NOT_SIGNED_IN,
  body: REFUSED,
  request: 'the agent host does not recognise this request',
  not_held_here: 'the session is no longer waiting for an answer on this host',
}

const reasonOf = (body: unknown, status: number): string => {
  if (typeof body === 'object' && body !== null) {
    const reason = Reflect.get(body, 'reason')
    if (typeof reason === 'string' && reason.length > 0) {
      return `${REFUSAL_SENTENCES[reason] ?? REFUSED} (${status})`
    }
  }
  return `the agent host answered ${status}`
}

const tokenOrNull = async (): Promise<string | null> => {
  try {
    return await fetchStreamToken()
  } catch {
    return null
  }
}

const postAnswer = async (body: AnswerBody): Promise<OperatorAnswerResult> => {
  const token = await tokenOrNull()
  if (token === null) return { ok: false, reason: NOT_SIGNED_IN }
  const response = await fetch(`${hostOrigin()}/operator-requests/answer`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
  if (response === null) return { ok: false, reason: UNREACHABLE }
  const answer: unknown = await response.json().catch(() => null)
  if (!response.ok) return { ok: false, reason: reasonOf(answer, response.status) }
  return { ok: true }
}

export async function answerOperatorRequest(
  args: AnswerOperatorRequestArgs,
): Promise<OperatorAnswerResult> {
  return postAnswer({ requestId: args.requestId, value: args.value })
}

export async function cancelOperatorRequest(
  args: CancelOperatorRequestArgs,
): Promise<OperatorAnswerResult> {
  return postAnswer({ requestId: args.requestId, cancel: true })
}
