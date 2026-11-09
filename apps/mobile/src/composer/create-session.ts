export type CreateSessionApi = {
  sessions: {
    create: {
      mutate(input: {
        projectId: string
        model?: string
        effort?: string
        fast?: boolean
      }): Promise<{ sessionId: string }>
    }
    post: { mutate(input: { sessionId: string; text: string }): Promise<unknown> }
  }
}

export const createSession = async (args: {
  api: CreateSessionApi
  projectId: string
  text: string
  model?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
}): Promise<string> => {
  const { sessionId } = await args.api.sessions.create.mutate({
    projectId: args.projectId,
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.effort === undefined ? {} : { effort: args.effort }),
    ...(args.fast === undefined ? {} : { fast: args.fast }),
  })
  await args.api.sessions.post.mutate({ sessionId, text: args.text })
  return sessionId
}
