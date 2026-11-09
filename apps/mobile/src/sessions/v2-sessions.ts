import type { SessionListOutput } from '@dltech/atlas-protocol'

export type V2SessionSummary = SessionListOutput['sessions'][number]

export const V2_SESSIONS_LIMIT = 100

export type ListV2SessionsApi = {
  sessions: {
    list: {
      query(input: { limit: number }): Promise<{ sessions: readonly V2SessionSummary[] }>
    }
  }
}

export const listV2Sessions = async (args: {
  api: ListV2SessionsApi
}): Promise<readonly V2SessionSummary[]> => {
  const listed = await args.api.sessions.list.query({ limit: V2_SESSIONS_LIMIT })
  return listed.sessions
}
