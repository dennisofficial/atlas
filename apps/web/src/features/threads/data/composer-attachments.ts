import { EPromptAttachmentStatus, type PromptAttachment } from '@dltech/atlas-ui/ai/prompt-input'
import { base64Bytes, EAttachmentStore, type Attachment, type SaidUpload } from '@dltech/atlas-core'
import { MAX_MESSAGE_IMAGES, type SaidImageWire } from '@dltech/atlas-wire/web'
import { EAttachmentStatus, OCTET_STREAM } from '@dltech/atlas-client/session'

import { MAX_IMAGE_DATA_CHARS } from './composer-images'

export type HeldAttachment = {
  id: string
  name: string
  size: number
  mediaType: string
  status: EAttachmentStatus
  progress: number
  upload?: SaidUpload | undefined
  image?: SaidImageWire | undefined
  previewUrl?: string | undefined
  sent?: boolean | undefined
}

export const contentTypeOf = (file: { type: string }): string =>
  file.type === '' ? OCTET_STREAM : file.type

export const startedAttachment = (args: { id: string; file: File }): HeldAttachment => ({
  id: args.id,
  name: args.file.name,
  size: args.file.size,
  mediaType: contentTypeOf(args.file),
  status: EAttachmentStatus.Uploading,
  progress: 0,
})

export const withReady = (args: {
  held: readonly HeldAttachment[]
  id: string
  upload: SaidUpload
}): HeldAttachment[] =>
  args.held.map((entry) =>
    entry.id === args.id
      ? {
          ...entry,
          status: EAttachmentStatus.Ready,
          progress: 1,
          upload: args.upload,
        }
      : entry,
  )

export const withInline = (args: {
  held: readonly HeldAttachment[]
  id: string
  image: SaidImageWire
}): HeldAttachment[] =>
  args.held.map((entry) =>
    entry.id === args.id
      ? {
          ...entry,
          image: args.image,
          previewUrl: `data:${args.image.mediaType};base64,${args.image.data}`,
        }
      : entry,
  )

export function fitsInline(args: {
  held: readonly HeldAttachment[]
  image: SaidImageWire
}): boolean {
  const inlined = args.held.flatMap((entry) => (entry.image === undefined ? [] : [entry.image]))
  if (inlined.length >= MAX_MESSAGE_IMAGES) return false
  const used = inlined.reduce((total, image) => total + image.data.length, 0)
  return used + args.image.data.length <= MAX_IMAGE_DATA_CHARS
}

export const uploadsOf = (held: readonly HeldAttachment[]): SaidUpload[] =>
  held.flatMap((entry) =>
    entry.status === EAttachmentStatus.Ready && entry.upload !== undefined ? [entry.upload] : [],
  )

const imageSizeOf = (image: SaidImageWire | undefined): Pick<Attachment, 'image'> =>
  image === undefined || (image.width === undefined && image.height === undefined)
    ? {}
    : { image: { width: image.width, height: image.height } }

function attachmentOf(entry: HeldAttachment): Attachment | null {
  const { upload, image } = entry
  if (upload !== undefined && entry.status === EAttachmentStatus.Ready) {
    return {
      id: upload.uploadId,
      name: upload.name,
      mediaType: upload.mediaType,
      size: upload.size,
      content: {
        store: EAttachmentStore.Upload,
        uploadId: upload.uploadId,
        pathname: upload.pathname,
        ...(image === undefined ? {} : { inline: image.data }),
      },
      ...imageSizeOf(image),
    }
  }
  if (image === undefined) return null
  return {
    id: entry.id,
    name: image.path,
    mediaType: image.mediaType,
    size: base64Bytes(image.data),
    source: image.path,
    content: { store: EAttachmentStore.Inline, data: image.data },
    ...imageSizeOf(image),
  }
}

export const attachmentsOf = (held: readonly HeldAttachment[]): Attachment[] =>
  held.flatMap((entry) => attachmentOf(entry) ?? [])

export const attachmentsFieldOf = (
  attachments: readonly Attachment[] | undefined,
): { attachments?: Attachment[] } =>
  attachments === undefined || attachments.length === 0 ? {} : { attachments: [...attachments] }

export const sameAttachments = (
  left: readonly Attachment[],
  right: readonly Attachment[],
): boolean =>
  left.length === right.length &&
  left.every((attachment, index) => attachment.id === right[index]?.id)

const CHIP_STATUS: Record<EAttachmentStatus, EPromptAttachmentStatus> = {
  [EAttachmentStatus.Uploading]: EPromptAttachmentStatus.Uploading,
  [EAttachmentStatus.Ready]: EPromptAttachmentStatus.Ready,
  [EAttachmentStatus.Failed]: EPromptAttachmentStatus.Failed,
}

export const chipOf = (held: HeldAttachment): PromptAttachment => ({
  id: held.id,
  name: held.name,
  previewUrl: held.previewUrl,
  status: CHIP_STATUS[held.status],
  progress: held.progress,
})

export function restoredAttachmentsOf(args: {
  uploads: readonly SaidUpload[]
  images: readonly SaidImageWire[]
  idOf: () => string
}): HeldAttachment[] {
  const unmatched = [...args.images]
  const fromUploads = args.uploads.map((upload): HeldAttachment => {
    const at = unmatched.findIndex((image) => image.path === upload.name)
    const image = at === -1 ? undefined : unmatched.splice(at, 1)[0]
    const held: HeldAttachment = {
      id: args.idOf(),
      name: upload.name,
      size: upload.size,
      mediaType: upload.mediaType,
      status: EAttachmentStatus.Ready,
      progress: 1,
      upload,
      sent: true,
    }
    return image === undefined
      ? held
      : (withInline({ held: [held], id: held.id, image })[0] ?? held)
  })
  const imageOnly = unmatched.map((image): HeldAttachment => {
    const held: HeldAttachment = {
      id: args.idOf(),
      name: image.path,
      size: image.data.length,
      mediaType: image.mediaType,
      status: EAttachmentStatus.Ready,
      progress: 1,
    }
    return withInline({ held: [held], id: held.id, image })[0] ?? held
  })
  return [...fromUploads, ...imageOnly]
}
