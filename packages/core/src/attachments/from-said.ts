import type { SaidFile, SaidImage, SaidMedia, SaidUpload } from '../events/body'
import { base64Bytes } from '../images/attached'
import { EAttachmentStore, type Attachment } from './attachment'

export type SaidAttachments = {
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
  uploads?: readonly SaidUpload[] | undefined
  media?: readonly SaidMedia[] | undefined
}

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const inlineOf = (data: string): Attachment['content'] => ({
  store: EAttachmentStore.Inline,
  data,
})

const pictureOf = (args: {
  image: SaidImage
  index: number
  upload: SaidUpload | undefined
}): Attachment => {
  const { image, upload } = args
  const name = upload?.name ?? basenameOf(image.path)
  return {
    id: upload?.uploadId ?? `image:${args.index}`,
    name,
    mediaType: image.mediaType,
    size: upload?.size ?? base64Bytes(image.data),
    content:
      upload === undefined
        ? inlineOf(image.data)
        : {
            store: EAttachmentStore.Upload,
            uploadId: upload.uploadId,
            pathname: upload.pathname,
            inline: image.data,
          },
    ...(image.width === undefined && image.height === undefined
      ? {}
      : { image: { width: image.width, height: image.height } }),
  }
}

export function attachmentsOf(said: SaidAttachments): readonly Attachment[] {
  const uploads = [...(said.uploads ?? [])]
  const pictures = (said.images ?? []).map((image, index) => {
    const at = uploads.findIndex((upload) => upload.name === image.path)
    const upload = at === -1 ? undefined : uploads.splice(at, 1)[0]
    return pictureOf({ image, index, upload })
  })
  const files = (said.files ?? []).map(
    (file, index): Attachment => ({
      id: `file:${index}`,
      name: file.filename ?? basenameOf(file.path),
      mediaType: file.mediaType,
      size: base64Bytes(file.data),
      content: inlineOf(file.data),
    }),
  )
  const remaining = uploads.map(
    (upload): Attachment => ({
      id: upload.uploadId,
      name: upload.name,
      mediaType: upload.mediaType,
      size: upload.size,
      content: {
        store: EAttachmentStore.Upload,
        uploadId: upload.uploadId,
        pathname: upload.pathname,
      },
    }),
  )
  const media = (said.media ?? []).map(
    (item, index): Attachment => ({
      id: `media:${index}:${item.media.hash}`,
      name: basenameOf(item.source ?? item.media.hash),
      mediaType: item.media.mediaType,
      size: item.media.size,
      content: { store: EAttachmentStore.Media, hash: item.media.hash },
      image: { width: item.media.width, height: item.media.height },
    }),
  )
  return [...pictures, ...files, ...remaining, ...media]
}
