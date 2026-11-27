import {
  EAttachmentStore,
  MAX_INLINE_BYTES,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  type Attachment,
  type SaidUpload,
} from '@dltech/atlas-core'
import {
  EAttachmentStatus,
  hasFailed,
  isUploading,
  OCTET_STREAM,
  readyAttachments,
} from '@dltech/atlas-client/session'

export enum EAttachRoute {
  Media = 'media',
  Upload = 'upload',
}

export type PickedFile = {
  name: string
  size: number
  mediaType: string
  uri: string
  blob?: Blob | undefined
}

export type HeldAttachment = {
  id: string
  name: string
  size: number
  mediaType: string
  uri: string
  blob?: Blob | undefined
  status: EAttachmentStatus
  progress: number
  upload?: SaidUpload | undefined
  hash?: string | undefined
}

export const attachRouteOf = (file: PickedFile): EAttachRoute =>
  (SUPPORTED_IMAGE_MEDIA_TYPES as readonly string[]).includes(file.mediaType) &&
  file.size > 0 &&
  file.size <= MAX_INLINE_BYTES
    ? EAttachRoute.Media
    : EAttachRoute.Upload

export const mediaTypeOf = (mediaType: string): string =>
  mediaType === '' ? OCTET_STREAM : mediaType

export const isImageMediaType = (mediaType: string): boolean => mediaType.startsWith('image/')

export const isVideoMediaType = (mediaType: string): boolean => mediaType.startsWith('video/')

export const startedAttachment = (args: { id: string; file: PickedFile }): HeldAttachment => ({
  id: args.id,
  name: args.file.name,
  size: args.file.size,
  mediaType: mediaTypeOf(args.file.mediaType),
  uri: args.file.uri,
  ...(args.file.blob === undefined ? {} : { blob: args.file.blob }),
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
          size: args.upload.size,
          upload: args.upload,
        }
      : entry,
  )

export const withPreview = (args: {
  held: readonly HeldAttachment[]
  id: string
  uri: string
}): HeldAttachment[] =>
  args.held.map((entry) => (entry.id === args.id ? { ...entry, uri: args.uri } : entry))

export const withMediaReady = (args: {
  held: readonly HeldAttachment[]
  id: string
  hash: string
}): HeldAttachment[] =>
  args.held.map((entry) =>
    entry.id === args.id
      ? { ...entry, status: EAttachmentStatus.Ready, progress: 1, hash: args.hash }
      : entry,
  )

const attachmentOf = (entry: HeldAttachment): Attachment | null => {
  if (entry.status !== EAttachmentStatus.Ready) return null
  if (entry.hash !== undefined)
    return {
      id: `media:${entry.hash}`,
      name: entry.name,
      mediaType: entry.mediaType,
      size: entry.size,
      content: { store: EAttachmentStore.Media, hash: entry.hash },
    }
  const upload = entry.upload
  if (upload === undefined) return null
  return {
    id: upload.uploadId,
    name: upload.name,
    mediaType: upload.mediaType,
    size: upload.size,
    content: {
      store: EAttachmentStore.Upload,
      uploadId: upload.uploadId,
      pathname: upload.pathname,
    },
  }
}

export const restoredHeldOf = (attachments: readonly Attachment[]): HeldAttachment[] =>
  attachments.flatMap((attachment): HeldAttachment[] => {
    const base = {
      name: attachment.name,
      size: attachment.size,
      mediaType: attachment.mediaType,
      uri: '',
      status: EAttachmentStatus.Ready,
      progress: 1,
    }
    const { content } = attachment
    if (content.store === EAttachmentStore.Media) {
      return [{ ...base, id: `media:${content.hash}`, hash: content.hash }]
    }
    if (content.store === EAttachmentStore.Upload) {
      return [
        {
          ...base,
          id: content.uploadId,
          upload: {
            uploadId: content.uploadId,
            pathname: content.pathname,
            name: attachment.name,
            size: attachment.size,
            mediaType: attachment.mediaType,
          },
        },
      ]
    }
    return []
  })

export const attachmentsOf = (held: readonly HeldAttachment[]): Attachment[] =>
  held.flatMap((entry) => attachmentOf(entry) ?? [])

export const sendableOf = (args: { text: string; held: readonly HeldAttachment[] }): boolean =>
  !isUploading(args.held) &&
  !hasFailed(args.held) &&
  (args.text.trim().length > 0 || readyAttachments(args.held).length > 0)

const UNITS = ['B', 'KB', 'MB', 'GB'] as const

export function describeBytes(size: number): string {
  let value = Math.max(0, size)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(value < 10 ? 1 : 0)
  return `${rounded} ${UNITS[unit]}`
}
