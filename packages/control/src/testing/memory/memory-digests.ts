import type { SessionDigestRow, SessionListParams } from '../../port'
import { sessionRowOf, type State } from './memory-state'

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

const firstMessageOf = (params: {
  state: State
  sessionId: string
}): { firstMessageText: string | null; firstMessageAt: string | null } => {
  const first = params.state.inbox
    .get(params.sessionId)
    ?.filter((entry) => entry.kind === 'message')
    .sort((a, b) => a.inboxId - b.inboxId)[0]
  if (first === undefined) return { firstMessageText: null, firstMessageAt: null }
  return {
    firstMessageText: textOf(first.payload),
    firstMessageAt: first.postedAt,
  }
}

export const sessionDigestsIn = (
  params: { state: State } & SessionListParams,
): SessionDigestRow[] =>
  [...params.state.sessions.values()]
    .filter((row) => row.userId === params.userId)
    .filter((row) => params.projectId === undefined || row.projectId === params.projectId)
    .filter((row) => params.sessionId === undefined || row.sessionId === params.sessionId)
    .filter(
      (row) =>
        params.spawnedBySessionId === undefined ||
        row.spawnedBySessionId === params.spawnedBySessionId,
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, params.limit)
    .map(sessionRowOf)
    .map((session) => ({
      ...session,
      lastEventAt: params.state.events.get(session.mainThreadId)?.at(-1)?.at ?? null,
      ...firstMessageOf({ state: params.state, sessionId: session.sessionId }),
    }))
