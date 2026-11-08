export type UploadHandle = { done: Promise<void>; abort: () => void }

export const sizeOfFile = async (uri: string): Promise<number> =>
  (await (await fetch(uri)).blob()).size

export function putBytes(args: {
  url: string
  uri: string
  mediaType: string
  onProgress: (fraction: number) => void
  blob?: Blob | undefined
}): UploadHandle {
  const request = new XMLHttpRequest()
  const done = (async () => {
    const blob = args.blob ?? (await (await fetch(args.uri)).blob())
    await new Promise<void>((resolve, reject) => {
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
      request.setRequestHeader('content-type', args.mediaType)
      request.send(blob)
    })
  })()
  return { done, abort: () => request.abort() }
}
