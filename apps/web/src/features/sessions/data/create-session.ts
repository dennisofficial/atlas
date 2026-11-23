import type { Attachment, SaidUpload } from '@dltech/atlas-core'
import type {
  ESandboxProvider,
  SessionCreateInput,
  SessionCreateOutput,
  SessionPostInput,
  SessionPostOutput,
} from '@dltech/atlas-protocol'

import { messageInputOf } from '@dltech/atlas-client/session'

export type SessionsApi = {
  create(input: SessionCreateInput): Promise<SessionCreateOutput>
  post(input: SessionPostInput): Promise<SessionPostOutput>
}

export async function createSessionWithMessage(args: {
  api: SessionsApi
  projectId?: string | null
  text: string
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
  model?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
  provider?: ESandboxProvider | undefined
}): Promise<string> {
  const { sessionId } = await args.api.create({
    ...(args.projectId === null || args.projectId === undefined
      ? {}
      : { projectId: args.projectId }),
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.effort === undefined ? {} : { effort: args.effort }),
    ...(args.fast === undefined ? {} : { fast: args.fast }),
    ...(args.provider === undefined ? {} : { provider: args.provider }),
    firstMessage: messageInputOf({
      text: args.text,
      media: args.media,
      uploads: args.uploads,
    }),
  })
  return sessionId
}
