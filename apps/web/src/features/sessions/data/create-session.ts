import type {
  SessionCreateInput,
  SessionCreateOutput,
  SessionPostInput,
  SessionPostMedia,
  SessionPostOutput,
} from '@dltech/atlas-protocol'

import { postInputOf } from './session-media'

export const FILES_UNSUPPORTED = 'v2 sessions take images only — remove the other files.'

export type SessionsApi = {
  create(input: SessionCreateInput): Promise<SessionCreateOutput>
  post(input: SessionPostInput): Promise<SessionPostOutput>
}

export async function createSessionWithMessage(args: {
  api: SessionsApi
  projectId: string
  text: string
  media: readonly SessionPostMedia[]
}): Promise<string> {
  const { sessionId } = await args.api.create({ projectId: args.projectId })
  await args.api.post(postInputOf({ sessionId, text: args.text, media: args.media }))
  return sessionId
}
