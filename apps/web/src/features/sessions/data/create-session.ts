import type {
  SessionCreateInput,
  SessionCreateOutput,
  SessionPostInput,
  SessionPostOutput,
} from '@dltech/atlas-protocol'

export const ATTACHMENTS_UNSUPPORTED = 'v2 sessions take text only — remove the attachments.'

export type SessionsApi = {
  create(input: SessionCreateInput): Promise<SessionCreateOutput>
  post(input: SessionPostInput): Promise<SessionPostOutput>
}

export async function createSessionWithMessage(args: {
  api: SessionsApi
  projectId: string
  text: string
  attachments: number
}): Promise<string> {
  if (args.attachments > 0) throw new Error(ATTACHMENTS_UNSUPPORTED)
  const { sessionId } = await args.api.create({ projectId: args.projectId })
  await args.api.post({ sessionId, text: args.text })
  return sessionId
}
