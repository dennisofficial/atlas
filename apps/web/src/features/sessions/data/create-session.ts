import type { Attachment, SaidUpload } from '@dltech/atlas-core'
import { sessionCreateInputOf } from '@dltech/atlas-client/session'
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
  const { sessionId } = await args.api.create(
    sessionCreateInputOf({
      projectId: args.projectId,
      model: args.model,
      effort: args.effort,
      fast: args.fast,
      provider: args.provider,
      firstMessage: messageInputOf({
        text: args.text,
        media: args.media,
        uploads: args.uploads,
      }),
    }),
  )
  return sessionId
}
