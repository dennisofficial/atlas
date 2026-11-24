import { type MediaUploadApi, storeImage, supportedMediaTypeOf } from '@dltech/atlas-client/session'
import { CryptoDigestAlgorithm, digest } from 'expo-crypto'

import type { PickedFile } from './attachment-plan'
import { putBytes, type UploadHandle } from './put-bytes'
import { readBytes } from './read-bytes'

const hashOf = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes.slice())), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

export const storeMedia = async (args: {
  api: MediaUploadApi
  file: PickedFile
  onProgress: (fraction: number) => void
  onHandle: (handle: UploadHandle) => void
}): Promise<string> => {
  const bytes = await readBytes({
    uri: args.file.uri,
    ...(args.file.blob === undefined ? {} : { blob: args.file.blob }),
  })
  return storeImage({
    bytes,
    mediaType: supportedMediaTypeOf(args.file.mediaType),
    api: args.api,
    put: (put) =>
      putBytes({
        url: put.url,
        uri: args.file.uri,
        mediaType: put.mediaType,
        onProgress: put.onProgress,
        ...(args.file.blob === undefined ? {} : { blob: args.file.blob }),
      }),
    onProgress: args.onProgress,
    onHandle: args.onHandle,
    hashOf,
  })
}
