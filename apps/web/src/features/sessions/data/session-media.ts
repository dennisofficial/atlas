import type { Attachment } from '@dltech/atlas-core'
import type { SessionPostMedia } from '@dltech/atlas-protocol'
import { EPromptAttachmentStatus, type PromptAttachment } from '@dltech/atlas-ui/ai/prompt-input'

import { EAttachmentStatus, planAttach } from '@/features/threads/data/composer-attachments'
import { isImageFile } from '@/features/threads/data/composer-images'

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

/** A media image already stored by hash, put back in the composer ready to send again. */
export const restoredMediaOf = (args: {
  item: { hash: string; name: string; mediaType: string; size: number; inline?: string | undefined }
  id: string
}): HeldMedia => ({
  id: args.id,
  name: args.item.name,
  status: EAttachmentStatus.Ready,
  progress: 1,
  hash: args.item.hash,
  mediaType: args.item.mediaType,
  size: args.item.size,
  ...(args.item.inline === undefined
    ? {}
    : { previewUrl: `data:${args.item.mediaType};base64,${args.item.inline}` }),
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
