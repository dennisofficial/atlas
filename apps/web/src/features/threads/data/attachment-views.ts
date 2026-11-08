import { inlineData, isImage, mediaHashOf, type Attachment } from '@dltech/atlas-core'
import type { MessageAttachment } from '@dltech/atlas-ui/ai/message-images'

const NO_ATTACHMENTS: readonly Attachment[] = Object.freeze([])
const NO_VIEWS: readonly MessageAttachment[] = Object.freeze([])

const srcOf = (args: {
  attachment: Attachment
  urls: ReadonlyMap<string, string>
}): string | undefined => {
  const inline = inlineData(args.attachment)
  if (inline !== undefined) return `data:${args.attachment.mediaType};base64,${inline}`
  const hash = mediaHashOf(args.attachment)
  return hash === null ? undefined : args.urls.get(hash)
}

export function attachmentViewsOf(args: {
  attachments: readonly Attachment[] | undefined
  urls: ReadonlyMap<string, string>
}): readonly MessageAttachment[] {
  const attachments = args.attachments ?? NO_ATTACHMENTS
  if (attachments.length === 0) return NO_VIEWS
  return attachments.map((attachment) => {
    const src = isImage(attachment) ? srcOf({ attachment, urls: args.urls }) : undefined
    return src === undefined
      ? { id: attachment.id, name: attachment.name }
      : { id: attachment.id, name: attachment.name, src }
  })
}
