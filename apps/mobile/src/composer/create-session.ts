import { sessionCreateInputOf } from '@dltech/atlas-client/sessions'
import type { SessionCreateInput } from '@dltech/atlas-protocol'

export type CreateSessionApi = {
  sessions: {
    create: {
      mutate(input: SessionCreateInput): Promise<{ sessionId: string }>
    }
  }
}

export const createSession = async (args: {
  api: CreateSessionApi
  projectId: string | null
  text: string
  model?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
}): Promise<string> => {
  const { sessionId } = await args.api.sessions.create.mutate(
    sessionCreateInputOf({
      projectId: args.projectId,
      model: args.model,
      effort: args.effort,
      fast: args.fast,
      firstMessage: { text: args.text },
    }),
  )
  return sessionId
}
