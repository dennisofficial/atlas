import type { DraftContent } from '@dltech/atlas-client/session'

import { api, cloudCall } from '@/lib/api-client'

export type SessionDraftsApi = {
  get: (sessionId: string | null) => Promise<DraftContent | null>
  put: (args: { sessionId: string | null; content: DraftContent }) => Promise<unknown>
  clear: (sessionId: string | null) => Promise<unknown>
}

export const sessionDraftsApi: SessionDraftsApi = {
  get: async (sessionId) => {
    const { draft } = await cloudCall(api.sessionDrafts.get.query({ sessionId }))
    return draft === null ? null : { text: draft.text, attachments: draft.attachments }
  },
  put: (args) =>
    cloudCall(
      api.sessionDrafts.put.mutate({
        sessionId: args.sessionId,
        text: args.content.text,
        attachments: [...args.content.attachments],
      }),
    ),
  clear: (sessionId) => cloudCall(api.sessionDrafts.clear.mutate({ sessionId })),
}
