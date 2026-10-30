import { api, cloudCall } from '@/lib/api-client'

import { contentTypeOf } from './composer-attachments'

export const presignUpload = (file: File) =>
  cloudCall(
    api.composerUploads.presign.mutate({
      name: file.name,
      size: file.size,
      mediaType: contentTypeOf(file),
    }),
  )

export const discardUpload = (pathname: string): Promise<unknown> =>
  cloudCall(api.composerUploads.discard.mutate({ pathname }))

export type UploadHandle = { done: Promise<void>; abort: () => void }

export function putFile(args: {
  url: string
  file: File
  onProgress: (fraction: number) => void
}): UploadHandle {
  const request = new XMLHttpRequest()
  const done = new Promise<void>((resolve, reject) => {
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) args.onProgress(event.loaded / event.total)
    }
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`the upload failed with ${request.status}`))
    request.onerror = () => reject(new Error('the upload failed'))
    request.onabort = () => reject(new Error('the upload was cancelled'))
    request.open('PUT', args.url)
    request.setRequestHeader('content-type', contentTypeOf(args.file))
    request.send(args.file)
  })
  return { done, abort: () => request.abort() }
}
