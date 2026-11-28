import { File, UploadType } from 'expo-file-system'

import { uploadFractionOf } from './upload-fraction'

export type UploadHandle = { done: Promise<void>; abort: () => void }

export const sizeOfFile = async (uri: string): Promise<number> => new File(uri).size ?? 0

export function putBytes(args: {
  url: string
  uri: string
  mediaType: string
  onProgress: (fraction: number) => void
  blob?: Blob | undefined
}): UploadHandle {
  const task = new File(args.uri).createUploadTask(args.url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: args.mediaType,
    headers: { 'content-type': args.mediaType },
    onProgress: ({ bytesSent, totalBytes }) => {
      const fraction = uploadFractionOf({ bytesSent, totalBytes })
      if (fraction !== undefined) args.onProgress(fraction)
    },
  })
  const done = task.uploadAsync().then((result) => {
    if (result.status < 200 || result.status >= 300)
      throw new Error(`the upload failed with ${result.status}`)
  })
  return { done, abort: () => task.cancel() }
}
