import {
  EAttachmentStore,
  MAX_MESSAGE_UPLOADS,
  MAX_UPLOAD_BYTES,
  type Attachment,
  type SaidUpload,
} from '@dltech/atlas-core'

export const OCTET_STREAM = 'application/octet-stream'
export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

export const TOO_MANY_FILES = `Up to ${MAX_MESSAGE_UPLOADS} files`
export const REMOVE_FAILED_FILES = 'Remove failed files first'
export const tooLargeNotice = (name: string): string => `${name} is over ${MAX_UPLOAD_MB} MB`
export const uploadFailedNotice = (name: string): string => `Couldn't upload ${name}`

export enum EAttachmentStatus {
  Uploading = 'uploading',
  Ready = 'ready',
  Failed = 'failed',
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
}

export const mediaTypeOf = (mediaType: string): string =>
  mediaType === '' ? OCTET_STREAM : mediaType

export const isImageMediaType = (mediaType: string): boolean => mediaType.startsWith('image/')

export function planAttach(args: { files: readonly PickedFile[]; held: number }): {
  accepted: PickedFile[]
  oversize: PickedFile[]
  droppedOverflow: boolean
} {
  const sized = args.files.filter((file) => file.size <= MAX_UPLOAD_BYTES)
  const room = Math.max(0, MAX_MESSAGE_UPLOADS - args.held)
  return {
    accepted: sized.slice(0, room),
    oversize: args.files.filter((file) => file.size > MAX_UPLOAD_BYTES),
    droppedOverflow: sized.length > room,
  }
}

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

export const withProgress = (args: {
  held: readonly HeldAttachment[]
  id: string
  progress: number
}): HeldAttachment[] =>
  args.held.map((entry) =>
    entry.id === args.id && entry.status === EAttachmentStatus.Uploading
      ? { ...entry, progress: args.progress }
      : entry,
  )

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

export const withFailed = (args: {
  held: readonly HeldAttachment[]
  id: string
}): HeldAttachment[] =>
  args.held.map((entry) =>
    entry.id === args.id ? { ...entry, status: EAttachmentStatus.Failed } : entry,
  )

export const withoutAttachment = (args: {
  held: readonly HeldAttachment[]
  id: string
}): HeldAttachment[] => args.held.filter((entry) => entry.id !== args.id)

export const isUploading = (held: readonly HeldAttachment[]): boolean =>
  held.some((entry) => entry.status === EAttachmentStatus.Uploading)

export const hasFailed = (held: readonly HeldAttachment[]): boolean =>
  held.some((entry) => entry.status === EAttachmentStatus.Failed)

export const readyAttachments = (held: readonly HeldAttachment[]): HeldAttachment[] =>
  held.filter((entry) => entry.status === EAttachmentStatus.Ready)

const attachmentOf = (entry: HeldAttachment): Attachment | null => {
  const upload = entry.upload
  if (upload === undefined || entry.status !== EAttachmentStatus.Ready) return null
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
