import type { SessionSummary } from '@dltech/atlas-protocol'

export const SESSIONS_LIMIT = 100

export type ListSessionsApi = {
  sessions: {
    list: {
      query(input: { limit: number }): Promise<{ sessions: readonly SessionSummary[] }>
    }
  }
}

export const listSessions = async (args: {
  api: ListSessionsApi
}): Promise<readonly SessionSummary[]> => {
  const listed = await args.api.sessions.list.query({ limit: SESSIONS_LIMIT })
  return listed.sessions
}
