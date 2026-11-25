import type { ThreadId } from '../events/ids'
import type { UploadPlacement } from '../uploads/placement'
import { EAttachmentStore, isImage, type Attachment } from './attachment'

export type MediaUrlRef = { hash: string } | { uploadId: string; pathname: string; name: string }

export type MediaUrlLookup = {
  ref: MediaUrlRef
  threadId: ThreadId
  placements?: ReadonlyMap<string, UploadPlacement> | undefined
}

export type MediaUrlResolver = {
  urlOf(args: MediaUrlLookup): Promise<string>
}

export type ResolvedMediaUrls = ReadonlyMap<string, string>

export const NO_MEDIA_URLS: ResolvedMediaUrls = new Map()

export const mediaUrlKeyOf = (ref: MediaUrlRef): string =>
  'hash' in ref ? `media:${ref.hash}` : `upload:${ref.uploadId}`

export function mediaUrlRefOf(attachment: Attachment): MediaUrlRef | null {
  if (!isImage(attachment)) return null
  const { content } = attachment
  if (content.store === EAttachmentStore.Media) return { hash: content.hash }
  if (content.store === EAttachmentStore.Upload) {
    return { uploadId: content.uploadId, pathname: content.pathname, name: attachment.name }
  }
  return null
}

export async function resolveMediaUrls({
  attachments,
  threadId,
  resolver,
  placements,
}: {
  attachments: readonly Attachment[]
  threadId: ThreadId
  resolver: MediaUrlResolver
  placements?: ReadonlyMap<string, UploadPlacement> | undefined
}): Promise<ResolvedMediaUrls> {
  const refs = new Map<string, MediaUrlRef>()
  for (const attachment of attachments) {
    const ref = mediaUrlRefOf(attachment)
    if (ref !== null) refs.set(mediaUrlKeyOf(ref), ref)
  }

  const settled = await Promise.all(
    [...refs].map(async ([key, ref]) => {
      try {
        return [key, await resolver.urlOf({ ref, threadId, placements })] as const
      } catch {
        return null
      }
    }),
  )

  return new Map(settled.filter((entry) => entry !== null))
}
