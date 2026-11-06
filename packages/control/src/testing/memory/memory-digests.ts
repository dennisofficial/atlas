import type { ControlSessionDigest, SessionListParams } from '../../port'
import type { State } from './memory-state'

const FIRST_MESSAGE_CHARS = 400

const textOf = (payload: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null || !('text' in parsed)) return null
    return typeof parsed.text === 'string' ? parsed.text.slice(0, FIRST_MESSAGE_CHARS) : null
  } catch {
    return null
  }
}

const firstMessageTextOf = (params: { state: State; sessionId: string }): string | null => {
  const first = params.state.inbox
    .get(params.sessionId)
    ?.filter((entry) => entry.kind === 'message')
    .sort((a, b) => a.inboxId - b.inboxId)[0]
  return first === undefined ? null : textOf(first.payload)
}

export const sessionDigestsIn = (
  params: { state: State } & SessionListParams,
): ControlSessionDigest[] =>
  [...params.state.sessions.values()]
    .filter((row) => row.userId === params.userId)
    .filter((row) => params.projectId === undefined || row.projectId === params.projectId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, params.limit)
    .map(({ nextInboxId: _nextInboxId, ...session }) => ({
      ...session,
      lastEventAt: params.state.events.get(session.mainThreadId)?.at(-1)?.at ?? null,
      firstMessageText: firstMessageTextOf({ state: params.state, sessionId: session.sessionId }),
    }))
