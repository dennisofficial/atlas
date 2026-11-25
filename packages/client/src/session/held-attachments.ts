import { MAX_MESSAGE_UPLOADS, MAX_UPLOAD_BYTES } from '@dltech/atlas-core'

export enum EAttachmentStatus {
  Uploading = 'uploading',
  Ready = 'ready',
  Failed = 'failed',
}

export const OCTET_STREAM = 'application/octet-stream'
export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

export const TOO_MANY_FILES = `Up to ${MAX_MESSAGE_UPLOADS} files`
export const REMOVE_FAILED_FILES = 'Remove failed files first'
export const tooLargeNotice = (name: string): string => `${name} is over ${MAX_UPLOAD_MB} MB`
export const uploadFailedNotice = (name: string): string => `Couldn't upload ${name}`

export type HeldStatus = { id: string; status: EAttachmentStatus; progress: number }

export function planAttach<T extends { size: number }>(args: {
  files: readonly T[]
  held: number
}): {
  accepted: T[]
  oversize: T[]
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

export const withProgress = <T extends HeldStatus>(args: {
  held: readonly T[]
  id: string
  progress: number
}): T[] =>
  args.held.map((entry) =>
    entry.id === args.id && entry.status === EAttachmentStatus.Uploading
      ? { ...entry, progress: args.progress }
      : entry,
  )

export const withFailed = <T extends HeldStatus>(args: { held: readonly T[]; id: string }): T[] =>
  args.held.map((entry) =>
    entry.id === args.id ? { ...entry, status: EAttachmentStatus.Failed } : entry,
  )

export const withoutAttachment = <T extends HeldStatus>(args: {
  held: readonly T[]
  id: string
}): T[] => args.held.filter((entry) => entry.id !== args.id)

export const isUploading = (held: readonly HeldStatus[]): boolean =>
  held.some((entry) => entry.status === EAttachmentStatus.Uploading)

export const hasFailed = (held: readonly HeldStatus[]): boolean =>
  held.some((entry) => entry.status === EAttachmentStatus.Failed)

export const readyAttachments = <T extends HeldStatus>(held: readonly T[]): T[] =>
  held.filter((entry) => entry.status === EAttachmentStatus.Ready)
