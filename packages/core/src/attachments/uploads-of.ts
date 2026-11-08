import type { SaidUpload } from './legacy-said'
import { EAttachmentStore, type Attachment } from './attachment'

export const uploadsOf = (attachments: readonly Attachment[]): SaidUpload[] =>
  attachments.flatMap((attachment) =>
    attachment.content.store === EAttachmentStore.Upload
      ? [
          {
            uploadId: attachment.content.uploadId,
            pathname: attachment.content.pathname,
            name: attachment.name,
            size: attachment.size,
            mediaType: attachment.mediaType,
          },
        ]
      : [],
  )
