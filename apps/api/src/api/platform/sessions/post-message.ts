import { EMessageOrigin, type Attachment, type SaidUpload } from '@dltech/atlas-core'
import type { MediaStore } from '@dltech/atlas-media'
import { inboxMessageSchema, type SessionPostMedia } from '@dltech/atlas-protocol'

import type { MediaRegistry } from './media-registry'
import { postedAttachmentsOf } from './post-attachments'

export type MessageDraftInput = {
  text: string
  clientId?: string | undefined
  media?: readonly SessionPostMedia[] | undefined
  uploads?: readonly SaidUpload[] | undefined
  attachments?: readonly Attachment[] | undefined
}

export const postMessageOf = async (args: {
  registry: MediaRegistry
  store: MediaStore
  userId: string
  draft: MessageDraftInput
}): Promise<{ payload: string; attachments: readonly Attachment[] }> => {
  const attachments = await postedAttachmentsOf({
    registry: args.registry,
    store: args.store,
    userId: args.userId,
    media: args.draft.media,
    uploads: args.draft.uploads,
    attachments: args.draft.attachments,
  })
  return {
    payload: JSON.stringify(
      inboxMessageSchema.parse({
        text: args.draft.text,
        via: EMessageOrigin.Operator,
        ...(args.draft.clientId === undefined ? {} : { clientId: args.draft.clientId }),
        ...(attachments.length === 0 ? {} : { attachments }),
      }),
    ),
    attachments,
  }
}
