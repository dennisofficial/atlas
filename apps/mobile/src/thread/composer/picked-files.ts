import { OCTET_STREAM } from '@dltech/atlas-client/session'
import type { DocumentPickerAsset } from 'expo-document-picker'
import type { ImagePickerAsset } from 'expo-image-picker'

import type { PickedFile } from './attachment-plan'

const EXTENSION_OF_SUBTYPE: Readonly<Record<string, string>> = {
  '': 'jpg',
  jpeg: 'jpg',
  quicktime: 'mov',
}

const extensionOf = (mediaType: string): string => {
  const subtype = mediaType.split('/')[1] ?? 'jpeg'
  const clean = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return EXTENSION_OF_SUBTYPE[clean] ?? clean
}

const isVideoAsset = (asset: ImagePickerAsset): boolean =>
  asset.type === 'video' || (asset.mimeType?.startsWith('video/') ?? false)

export const pickedMediaOf = (args: {
  asset: ImagePickerAsset
  index: number
  at: number
}): PickedFile => {
  const video = isVideoAsset(args.asset)
  const mediaType = args.asset.mimeType ?? (video ? 'video/quicktime' : 'image/jpeg')
  const stem = video ? 'video' : 'photo'
  return {
    name: args.asset.fileName ?? `${stem}-${args.at}-${args.index}.${extensionOf(mediaType)}`,
    size: args.asset.fileSize ?? args.asset.file?.size ?? 0,
    mediaType,
    uri: args.asset.uri,
    ...(args.asset.file === undefined ? {} : { blob: args.asset.file }),
  }
}

export const pickedDocumentOf = (asset: DocumentPickerAsset): PickedFile => ({
  name: asset.name,
  size: asset.size ?? asset.file?.size ?? 0,
  mediaType: asset.mimeType ?? OCTET_STREAM,
  uri: asset.uri,
  ...(asset.file === undefined ? {} : { blob: asset.file }),
})
