export type CreateSessionApi = {
  sessions: {
    create: { mutate(input: { projectId: string }): Promise<{ sessionId: string }> }
    post: { mutate(input: { sessionId: string; text: string }): Promise<unknown> }
  }
}

export const createSession = async (args: {
  api: CreateSessionApi
  projectId: string
  text: string
}): Promise<string> => {
  const { sessionId } = await args.api.sessions.create.mutate({ projectId: args.projectId })
  await args.api.sessions.post.mutate({ sessionId, text: args.text })
  return sessionId
}
