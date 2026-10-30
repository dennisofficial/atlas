import { EPromptAttachmentStatus, type PromptAttachment } from '@dltech/atlas-ui/ai/prompt-input'
import { MAX_MESSAGE_UPLOADS, MAX_UPLOAD_BYTES, type SaidUpload } from '@dltech/atlas-core'
import { MAX_MESSAGE_IMAGES, type SaidImageWire } from '@dltech/atlas-wire/web'

import { MAX_IMAGE_DATA_CHARS } from './composer-images'

export const TOAST_TOO_MANY_FILES = `Up to ${MAX_MESSAGE_UPLOADS} files`
export const TOAST_REMOVE_FAILED = 'Remove failed files first'
export const toastOverLimit = (name: string): string => `${name} is over 100 MB`
export const toastUploadFailed = (name: string): string => `Couldn't upload ${name}`

export enum EAttachmentStatus {
  Uploading = 'uploading',
  Ready = 'ready',
  Failed = 'failed',
}

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
}

export const OCTET_STREAM = 'application/octet-stream'

export const contentTypeOf = (file: { type: string }): string =>
  file.type === '' ? OCTET_STREAM : file.type

export function planAttach(args: { files: readonly File[]; held: number }): {
  accepted: File[]
  oversize: File[]
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

export const startedAttachment = (args: { id: string; file: File }): HeldAttachment => ({
  id: args.id,
  name: args.file.name,
  size: args.file.size,
  mediaType: contentTypeOf(args.file),
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

export const isUploading = (held: readonly HeldAttachment[]): boolean =>
  held.some((entry) => entry.status === EAttachmentStatus.Uploading)

export const hasFailed = (held: readonly HeldAttachment[]): boolean =>
  held.some((entry) => entry.status === EAttachmentStatus.Failed)

export const uploadsOf = (held: readonly HeldAttachment[]): SaidUpload[] =>
  held.flatMap((entry) =>
    entry.status === EAttachmentStatus.Ready && entry.upload !== undefined ? [entry.upload] : [],
  )

export const inlineImagesOf = (held: readonly HeldAttachment[]): SaidImageWire[] =>
  held.flatMap((entry) =>
    entry.image === undefined
      ? []
      : [entry.upload === undefined ? entry.image : { ...entry.image, path: entry.upload.name }],
  )

export const uploadsFieldOf = (
  uploads: readonly SaidUpload[] | undefined,
): { uploads?: SaidUpload[] } =>
  uploads === undefined || uploads.length === 0 ? {} : { uploads: [...uploads] }

export const sameUploads = (left: readonly SaidUpload[], right: readonly SaidUpload[]): boolean =>
  left.length === right.length &&
  left.every((upload, index) => upload.uploadId === right[index]?.uploadId)

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
