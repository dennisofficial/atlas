import { EAttachmentStore, isImage, type Attachment } from './attachment'

/**
 * A stored picture, described the way the file that carries it into the sandbox is: the blob holds
 * one copy, content-addressed, and the sandbox gets that copy at a path the model can open.
 */
export type SaidMediaFile = {
  hash: string
  name: string
  size: number
  mediaType: string
}

export const mediaFilesOf = (attachments: readonly Attachment[]): SaidMediaFile[] =>
  attachments.flatMap((attachment) => {
    const { content } = attachment
    if (content.store !== EAttachmentStore.Media || !isImage(attachment)) return []
    return [
      {
        hash: content.hash,
        name: attachment.name,
        size: attachment.size,
        mediaType: attachment.mediaType,
      },
    ]
  })
