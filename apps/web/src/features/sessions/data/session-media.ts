import {
  attachmentsOf,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  type Attachment,
  type SaidUpload,
  type SupportedImageMediaType,
} from '@dltech/atlas-core'
import type {
  MediaConfirmInput,
  MediaConfirmOutput,
  MediaPresignInput,
  MediaPresignOutput,
  SessionMessageDraft,
  SessionPostInput,
  SessionPostMedia,
} from '@dltech/atlas-protocol'
import { EPromptAttachmentStatus, type PromptAttachment } from '@dltech/atlas-ui/ai/prompt-input'

import { EAttachmentStatus, planAttach } from '@/features/threads/data/composer-attachments'
import { isImageFile } from '@/features/threads/data/composer-images'
import type { UploadHandle } from '@/features/threads/data/composer-uploads-api'

export const TOAST_IMAGES_ONLY = 'Only images can be attached here'

export type HeldMedia = {
  id: string
  name: string
  status: EAttachmentStatus
  progress: number
  previewUrl?: string | undefined
  hash?: string | undefined
  mediaType?: string | undefined
  size?: number | undefined
}

export type MediaUploadApi = {
  presign(input: MediaPresignInput): Promise<MediaPresignOutput>
  confirm(input: MediaConfirmInput): Promise<MediaConfirmOutput>
}

export type PutImage = (args: {
  url: string
  file: File
  onProgress: (fraction: number) => void
}) => UploadHandle

export function supportedMediaTypeOf(mediaType: string): SupportedImageMediaType {
  const found = SUPPORTED_IMAGE_MEDIA_TYPES.find((supported) => supported === mediaType)
  if (found === undefined) throw new Error(`${mediaType} cannot be attached`)
  return found
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function storeImage(args: {
  bytes: Uint8Array
  mediaType: SupportedImageMediaType
  api: MediaUploadApi
  put: PutImage
  onProgress: (fraction: number) => void
  onHandle: (handle: UploadHandle) => void
}): Promise<string> {
  const hash = await sha256Hex(args.bytes)
  const presigned = await args.api.presign({
    hash,
    size: args.bytes.byteLength,
    mediaType: args.mediaType,
  })
  if (presigned.exists) return hash
  const handle = args.put({
    url: presigned.uploadUrl,
    file: new File([args.bytes.slice()], hash, { type: args.mediaType }),
    onProgress: args.onProgress,
  })
  args.onHandle(handle)
  await handle.done
  await args.api.confirm({ hash })
  return hash
}

export function planImageAttach(args: { files: readonly File[]; held: number }): {
  accepted: File[]
  oversize: File[]
  rejected: File[]
  droppedOverflow: boolean
} {
  const images = args.files.filter(isImageFile)
  return {
    ...planAttach({ files: images, held: args.held }),
    rejected: args.files.filter((file) => !isImageFile(file)),
  }
}

export const startedMedia = (args: { id: string; file: File }): HeldMedia => ({
  id: args.id,
  name: args.file.name,
  status: EAttachmentStatus.Uploading,
  progress: 0,
})

const mapEntry = (args: {
  held: readonly HeldMedia[]
  id: string
  change: (entry: HeldMedia) => HeldMedia
}): HeldMedia[] => args.held.map((entry) => (entry.id === args.id ? args.change(entry) : entry))

export const withMediaEncoded = (args: {
  held: readonly HeldMedia[]
  id: string
  name: string
  previewUrl: string
  mediaType?: string | undefined
  size?: number | undefined
}): HeldMedia[] =>
  mapEntry({
    ...args,
    change: (entry) => ({
      ...entry,
      name: args.name,
      previewUrl: args.previewUrl,
      mediaType: args.mediaType,
      size: args.size,
    }),
  })

export const withMediaProgress = (args: {
  held: readonly HeldMedia[]
  id: string
  progress: number
}): HeldMedia[] =>
  mapEntry({
    ...args,
    change: (entry) =>
      entry.status === EAttachmentStatus.Uploading ? { ...entry, progress: args.progress } : entry,
  })

export const withMediaReady = (args: {
  held: readonly HeldMedia[]
  id: string
  hash: string
}): HeldMedia[] =>
  mapEntry({
    ...args,
    change: (entry) => ({
      ...entry,
      status: EAttachmentStatus.Ready,
      progress: 1,
      hash: args.hash,
    }),
  })

export const withMediaFailed = (args: { held: readonly HeldMedia[]; id: string }): HeldMedia[] =>
  mapEntry({
    ...args,
    change: (entry) => ({ ...entry, status: EAttachmentStatus.Failed }),
  })

export const isMediaUploading = (held: readonly HeldMedia[]): boolean =>
  held.some((entry) => entry.status === EAttachmentStatus.Uploading)

export const hasMediaFailed = (held: readonly HeldMedia[]): boolean =>
  held.some((entry) => entry.status === EAttachmentStatus.Failed)

export function readyAttachmentsOf(held: readonly HeldMedia[]): Attachment[] {
  const media = readyMediaOf(held)
  const known = new Map(held.map((entry) => [entry.hash, entry]))
  return media.map((item) => {
    const entry = known.get(item.hash)
    return {
      id: `media:${item.hash}`,
      name: item.source ?? item.hash,
      mediaType: entry?.mediaType ?? 'image/png',
      size: entry?.size ?? 0,
      content: { store: 'media', hash: item.hash },
    }
  })
}

export function readyMediaOf(held: readonly HeldMedia[]): SessionPostMedia[] {
  const seen = new Set<string>()
  return held.flatMap((entry) => {
    if (entry.status !== EAttachmentStatus.Ready || entry.hash === undefined) return []
    if (seen.has(entry.hash)) return []
    seen.add(entry.hash)
    return [{ hash: entry.hash, source: entry.name.slice(0, 200) }]
  })
}

export const messageInputOf = (args: {
  text: string
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): SessionMessageDraft => {
  const attachments = [...args.media, ...attachmentsOf({ uploads: args.uploads })]
  return {
    text: args.text,
    ...(attachments.length === 0 ? {} : { attachments }),
  }
}

export const postInputOf = (args: {
  sessionId: string
  text: string
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): SessionPostInput => ({ sessionId: args.sessionId, ...messageInputOf(args) })

const CHIP_STATUS: Record<EAttachmentStatus, EPromptAttachmentStatus> = {
  [EAttachmentStatus.Uploading]: EPromptAttachmentStatus.Uploading,
  [EAttachmentStatus.Ready]: EPromptAttachmentStatus.Ready,
  [EAttachmentStatus.Failed]: EPromptAttachmentStatus.Failed,
}

export const mediaChipOf = (held: HeldMedia): PromptAttachment => ({
  id: held.id,
  name: held.name,
  previewUrl: held.previewUrl,
  status: CHIP_STATUS[held.status],
  progress: held.progress,
})
