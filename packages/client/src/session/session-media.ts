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
} from '@dltech/atlas-protocol'

export type UploadHandle = { done: Promise<void>; abort: () => void }

export type MediaUploadApi = {
  presign(input: MediaPresignInput): Promise<MediaPresignOutput>
  confirm(input: MediaConfirmInput): Promise<MediaConfirmOutput>
}

export type PutImage = (args: {
  url: string
  bytes: Uint8Array
  mediaType: SupportedImageMediaType
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
  hashOf?: (bytes: Uint8Array) => Promise<string>
}): Promise<string> {
  const hash = await (args.hashOf ?? sha256Hex)(args.bytes)
  const presigned = await args.api.presign({
    hash,
    size: args.bytes.byteLength,
    mediaType: args.mediaType,
  })
  if (presigned.exists) return hash
  const handle = args.put({
    url: presigned.uploadUrl,
    bytes: args.bytes,
    mediaType: args.mediaType,
    onProgress: args.onProgress,
  })
  args.onHandle(handle)
  await handle.done
  await args.api.confirm({ hash })
  return hash
}

export const messageInputOf = (args: {
  text: string
  clientId?: string | undefined
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): SessionMessageDraft => {
  const attachments = [...args.media, ...attachmentsOf({ uploads: args.uploads })]
  return {
    text: args.text,
    ...(args.clientId === undefined ? {} : { clientId: args.clientId }),
    ...(attachments.length === 0 ? {} : { attachments }),
  }
}

export const postInputOf = (args: {
  sessionId: string
  text: string
  clientId?: string | undefined
  media: readonly Attachment[]
  uploads: readonly SaidUpload[]
}): SessionPostInput => ({ sessionId: args.sessionId, ...messageInputOf(args) })
