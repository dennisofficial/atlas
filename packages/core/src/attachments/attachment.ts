export enum EAttachmentStore {
  Inline = 'inline',
  Upload = 'upload',
  Media = 'media',
}

export type AttachmentContent =
  | { store: `${EAttachmentStore.Inline}`; data: string }
  | {
      store: `${EAttachmentStore.Upload}`
      uploadId: string
      pathname: string
      inline?: string | undefined
    }
  | {
      store: `${EAttachmentStore.Media}`
      hash: string
      inline?: string | undefined
    }

export type Attachment = {
  id: string
  name: string
  mediaType: string
  size: number
  source?: string | undefined
  content: AttachmentContent
  image?: { width?: number | undefined; height?: number | undefined } | undefined
}

export const isImage = (attachment: Attachment): boolean =>
  attachment.mediaType.startsWith('image/')

export const inlineData = (attachment: Attachment): string | undefined =>
  attachment.content.store === EAttachmentStore.Inline
    ? attachment.content.data
    : attachment.content.inline

export const mediaHashOf = (attachment: Attachment): string | null =>
  attachment.content.store === EAttachmentStore.Media ? attachment.content.hash : null
