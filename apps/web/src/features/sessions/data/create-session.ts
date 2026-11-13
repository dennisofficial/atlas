import type { Attachment, SaidUpload } from '@dltech/atlas-core'
import type {
  SessionCreateInput,
  SessionCreateOutput,
  SessionPostInput,
  SessionPostOutput,
} from '@dltech/atlas-protocol'

import { messageInputOf } from './session-media'

export type SessionsApi = {
  create(input: SessionCreateInput): Promise<SessionCreateOutput>
  post(input: SessionPostInput): Promise<SessionPostOutput>
}

export async function createSessionWithMessage(args: {
  api: SessionsApi
  projectId: string
  text: string
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
  model?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
}): Promise<string> {
  const { sessionId } = await args.api.create({
    projectId: args.projectId,
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.effort === undefined ? {} : { effort: args.effort }),
    ...(args.fast === undefined ? {} : { fast: args.fast }),
    firstMessage: messageInputOf({
      text: args.text,
      media: args.media,
      uploads: args.uploads,
    }),
  })
  return sessionId
}
