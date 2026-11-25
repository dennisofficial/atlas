import { OCTET_STREAM } from '@dltech/atlas-client/session'
import type { DocumentPickerAsset } from 'expo-document-picker'
import type { ImagePickerAsset } from 'expo-image-picker'

import type { PickedFile } from './attachment-plan'

const extensionOf = (mediaType: string): string => {
  const subtype = mediaType.split('/')[1] ?? 'jpeg'
  const clean = subtype.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (clean === '' || clean === 'jpeg') return 'jpg'
  return clean
}

export const pickedPhotoOf = (args: {
  asset: ImagePickerAsset
  index: number
  at: number
}): PickedFile => {
  const mediaType = args.asset.mimeType ?? 'image/jpeg'
  return {
    name: args.asset.fileName ?? `photo-${args.at}-${args.index}.${extensionOf(mediaType)}`,
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
