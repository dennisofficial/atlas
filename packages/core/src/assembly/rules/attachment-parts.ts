import {
  EAttachmentStore,
  inlineData,
  isImage,
  type Attachment,
} from '../../attachments/attachment'
import {
  mediaUrlKeyOf,
  mediaUrlRefOf,
  NO_MEDIA_URLS,
  type ResolvedMediaUrls,
} from '../../attachments/media-urls'
import { base64Bytes, imagePathLine } from '../../images/attached'
import {
  EImageDelivery,
  NEUTRAL_IMAGE_CAPABILITIES,
  planDelivery,
  type ImageCapabilities,
} from '../../images/delivery'
import type { FilePart, ImagePart } from '../../message/parts'

export type AttachmentParts = { shown: (ImagePart | FilePart)[]; named: string[] }

export type DeliveryContext = {
  capabilities?: ImageCapabilities | undefined
  urls?: ResolvedMediaUrls | undefined
}

const sourceOf = (attachment: Attachment): string => attachment.source ?? attachment.name

const sizeOf = (attachment: Attachment) => ({
  width: attachment.image?.width,
  height: attachment.image?.height,
})

function placeFile({
  attachment,
  data,
  parts,
}: {
  attachment: Attachment
  data: string
  parts: AttachmentParts
}): void {
  if (attachment.content.store !== EAttachmentStore.Inline) return
  parts.shown.push({
    type: 'file',
    data,
    mediaType: attachment.mediaType,
    filename: attachment.name,
    source: sourceOf(attachment),
  })
}

function placeImage({
  attachment,
  parts,
  delivery,
}: {
  attachment: Attachment
  parts: AttachmentParts
  delivery: DeliveryContext
}): void {
  const data = inlineData(attachment)
  const ref = mediaUrlRefOf(attachment)
  const url = ref === null ? undefined : delivery.urls?.get(mediaUrlKeyOf(ref))
  const picture = { path: sourceOf(attachment), ...sizeOf(attachment) }

  const plan = planDelivery({
    facts: {
      byteLength: data === undefined ? attachment.size : base64Bytes(data),
      ...sizeOf(attachment),
    },
    capabilities: delivery.capabilities ?? NEUTRAL_IMAGE_CAPABILITIES,
    sources: { inline: data !== undefined, url: url !== undefined },
  })

  const shown = {
    mediaType: attachment.mediaType,
    source: sourceOf(attachment),
    ...sizeOf(attachment),
  }

  if (plan.delivery === EImageDelivery.Url && url !== undefined) {
    parts.shown.push({ type: 'image', bytes: { kind: 'url', url }, ...shown })
    return
  }
  if (plan.delivery === EImageDelivery.Inline && data !== undefined) {
    parts.shown.push({ type: 'image', bytes: { kind: 'inline', data }, ...shown })
    return
  }
  parts.named.push(imagePathLine(picture))
}

export function attachmentPartsOf({
  attachments,
  delivery = {},
}: {
  attachments: readonly Attachment[]
  delivery?: DeliveryContext
}): AttachmentParts {
  const parts: AttachmentParts = { shown: [], named: [] }
  for (const attachment of attachments) {
    if (isImage(attachment)) {
      placeImage({ attachment, parts, delivery: { urls: NO_MEDIA_URLS, ...delivery } })
      continue
    }
    const data = inlineData(attachment)
    if (data !== undefined) placeFile({ attachment, data, parts })
  }
  return parts
}
