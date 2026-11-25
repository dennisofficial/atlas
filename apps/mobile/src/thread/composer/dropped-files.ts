import { OCTET_STREAM } from '@dltech/atlas-client/session'
import type { DropAsset } from 'expo-drag-drop-content-view'

import type { PickedFile } from './attachment-plan'

const extensionOf = (mediaType: string): string => {
  const subtype =
    mediaType
      .split('/')[1]
      ?.replace(/[^a-z0-9]/gi, '')
      .toLowerCase() ?? ''
  if (subtype === '') return 'bin'
  return subtype === 'jpeg' ? 'jpg' : subtype
}

export const droppedFilesOf = (args: { assets: readonly DropAsset[]; at: number }): PickedFile[] =>
  args.assets.flatMap((asset, index) => {
    if (asset.uri === undefined) return []
    const mediaType = asset.type === '' ? OCTET_STREAM : asset.type
    return [
      {
        name: asset.fileName ?? `dropped-${args.at}-${index + 1}.${extensionOf(mediaType)}`,
        size: 0,
        mediaType,
        uri: asset.uri,
      },
    ]
  })
