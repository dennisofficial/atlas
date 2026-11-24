import {
  EAttachmentStore,
  inlineData,
  isImage,
  mediaHashOf,
  type Attachment,
} from '@dltech/atlas-core'

export type AttachmentSource =
  | { kind: 'ready'; uri: string }
  | { kind: 'fetch'; key: string; pathname: string }
  | { kind: 'media'; key: string; hash: string }
  | { kind: 'unavailable' }

export type FetchableSource =
  | { kind: 'upload'; key: string; pathname: string }
  | { kind: 'media'; key: string; hash: string }

export type AttachmentView = {
  key: string
  id: string
  name: string
  mediaType: string
  size: number
  image: boolean
  uri: string | undefined
}

export function sourceOf(attachment: Attachment): AttachmentSource {
  const inline = inlineData(attachment)
  if (inline !== undefined)
    return { kind: 'ready', uri: `data:${attachment.mediaType};base64,${inline}` }
  if (attachment.content.store === EAttachmentStore.Upload) {
    const pathname = attachment.content.pathname
    return { kind: 'fetch', key: `upload:${pathname}`, pathname }
  }
  if (attachment.content.store === EAttachmentStore.Media) {
    const hash = mediaHashOf(attachment)
    if (hash !== null) return { kind: 'media', key: `media:${hash}`, hash }
  }
  return { kind: 'unavailable' }
}

export const fetchableOf = (attachments: readonly Attachment[]): FetchableSource[] =>
  attachments.flatMap<FetchableSource>((attachment) => {
    const source = sourceOf(attachment)
    if (source.kind === 'fetch')
      return [{ kind: 'upload', key: source.key, pathname: source.pathname }]
    if (source.kind === 'media') return [{ kind: 'media', key: source.key, hash: source.hash }]
    return []
  })

export const viewsOf = (args: {
  attachments: readonly Attachment[]
  sources: ReadonlyMap<string, string>
}): AttachmentView[] =>
  args.attachments.map((attachment, index) => {
    const source = sourceOf(attachment)
    const uri =
      source.kind === 'ready'
        ? source.uri
        : source.kind === 'unavailable'
          ? undefined
          : args.sources.get(source.key)
    return {
      key: `${attachment.id}:${index}`,
      id: attachment.id,
      name: attachment.name,
      mediaType: attachment.mediaType,
      size: attachment.size,
      image: isImage(attachment),
      uri,
    }
  })
