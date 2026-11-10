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
import { base64Bytes, imagePathLine, looksLikePath, missingImageLine } from '../../images/attached'
import {
  EImageDelivery,
  NEUTRAL_IMAGE_CAPABILITIES,
  planDelivery,
  type ImageCapabilities,
} from '../../images/delivery'
import { supportedImageMediaTypeOf } from '../../images/limits'
import type { MediaRef } from '../../media/media-ref'
import type { FilePart, ImagePart, MediaPart } from '../../message/parts'
import { EUploadState, type UploadPlacement } from '../../uploads/placement'

export type AttachmentParts = { shown: (ImagePart | FilePart | MediaPart)[]; named: string[] }

export type DeliveryContext = {
  capabilities?: ImageCapabilities | undefined
  urls?: ResolvedMediaUrls | undefined
  placements?: ReadonlyMap<string, UploadPlacement> | undefined
}

const sourceOf = (attachment: Attachment): string => attachment.source ?? attachment.name

const sizeOf = (attachment: Attachment) => ({
  width: attachment.image?.width,
  height: attachment.image?.height,
})

/**
 * A path the sandbox really has: where an upload was placed, or a source its sender wrote as one.
 * A file name is not a path — the model reads the cwd when it is handed one, finds nothing, and
 * has to hunt for a picture that was never in reach.
 */
function readablePathOf({
  attachment,
  placements,
}: {
  attachment: Attachment
  placements: ReadonlyMap<string, UploadPlacement> | undefined
}): string | undefined {
  const { content } = attachment
  if (content.store === EAttachmentStore.Upload) {
    const placement = placements?.get(content.uploadId)
    return placement?.state === EUploadState.Ready ? placement.path : undefined
  }
  const source = attachment.source
  return source === undefined || !looksLikePath(source) ? undefined : source
}

/** A stored picture's reference, which the agent host turns into a signed url or inline bytes. */
function mediaRefOf(attachment: Attachment): MediaRef | null {
  const { content } = attachment
  if (content.store !== EAttachmentStore.Media) return null
  const mediaType = supportedImageMediaTypeOf(attachment.mediaType)
  const { width, height } = sizeOf(attachment)
  if (mediaType === null || width === undefined || height === undefined) return null
  return { hash: content.hash, mediaType, size: attachment.size, width, height }
}

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
  const size = sizeOf(attachment)
  const source = sourceOf(attachment)
  const capabilities = delivery.capabilities ?? NEUTRAL_IMAGE_CAPABILITIES

  const plan = planDelivery({
    facts: { byteLength: data === undefined ? attachment.size : base64Bytes(data), ...size },
    capabilities,
    sources: { inline: data !== undefined, url: url !== undefined },
  })

  if (plan.delivery === EImageDelivery.Url && url !== undefined) {
    parts.shown.push({
      type: 'image',
      bytes: { kind: 'url', url },
      mediaType: attachment.mediaType,
      source,
      ...size,
    })
    return
  }
  if (plan.delivery === EImageDelivery.Inline && data !== undefined) {
    parts.shown.push({
      type: 'image',
      bytes: { kind: 'inline', data },
      mediaType: attachment.mediaType,
      source,
      ...size,
    })
    return
  }

  const media = capabilities.images === 'none' ? null : mediaRefOf(attachment)
  if (media !== null) {
    parts.shown.push({
      type: 'media',
      media,
      ...(attachment.source === undefined ? {} : { source: attachment.source }),
    })
    return
  }

  const path = readablePathOf({ attachment, placements: delivery.placements })
  parts.named.push(path === undefined ? missingImageLine(source) : imagePathLine({ path, ...size }))
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
