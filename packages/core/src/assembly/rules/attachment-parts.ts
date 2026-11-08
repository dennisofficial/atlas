import {
  EAttachmentStore,
  inlineData,
  isImage,
  type Attachment,
} from '../../attachments/attachment'
import { imagePathLine, inlinable } from '../../images/attached'
import type { FilePart, ImagePart } from '../../message/parts'

export type AttachmentParts = {
  shown: (ImagePart | FilePart)[]
  named: string[]
}

const sourceOf = (attachment: Attachment): string => attachment.source ?? attachment.name

const sizeOf = (attachment: Attachment) => ({
  width: attachment.image?.width,
  height: attachment.image?.height,
})

function placeInline({
  attachment,
  data,
  parts,
}: {
  attachment: Attachment
  data: string
  parts: AttachmentParts
}): void {
  if (!isImage(attachment)) {
    if (attachment.content.store !== EAttachmentStore.Inline) return
    parts.shown.push({
      type: 'file',
      data,
      mediaType: attachment.mediaType,
      filename: attachment.name,
      source: sourceOf(attachment),
    })
    return
  }
  const picture = { path: sourceOf(attachment), data, ...sizeOf(attachment) }
  if (!inlinable(picture)) {
    parts.named.push(imagePathLine(picture))
    return
  }
  parts.shown.push({
    type: 'image',
    data,
    mediaType: attachment.mediaType,
    source: sourceOf(attachment),
    ...sizeOf(attachment),
  })
}

export function attachmentPartsOf(attachments: readonly Attachment[]): AttachmentParts {
  const parts: AttachmentParts = { shown: [], named: [] }
  for (const attachment of attachments) {
    const data = inlineData(attachment)
    if (data !== undefined) {
      placeInline({ attachment, data, parts })
      continue
    }
    if (attachment.content.store === EAttachmentStore.Media) {
      parts.named.push(imagePathLine({ path: sourceOf(attachment), ...sizeOf(attachment) }))
    }
  }
  return parts
}
