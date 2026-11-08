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
  | { kind: 'unavailable' }

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
  const hash = mediaHashOf(attachment)
  return hash === null ? { kind: 'unavailable' } : { kind: 'unavailable' }
}

export const fetchableOf = (
  attachments: readonly Attachment[],
): { key: string; pathname: string }[] =>
  attachments.flatMap((attachment) => {
    const source = sourceOf(attachment)
    return source.kind === 'fetch' ? [{ key: source.key, pathname: source.pathname }] : []
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
        : source.kind === 'fetch'
          ? args.sources.get(source.key)
          : undefined
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
