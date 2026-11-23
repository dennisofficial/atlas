import type { UploadHandle } from '@dltech/atlas-client/session'
import type { PutImage } from '@dltech/atlas-client/session'

export const putBytes = (args: {
  url: string
  bytes: Uint8Array
  mediaType: string
  onProgress: (fraction: number) => void
  fetchFn?: typeof fetch | undefined
}): UploadHandle => {
  const fetchFn = args.fetchFn ?? globalThis.fetch
  const controller = new AbortController()

  const done = fetchFn(args.url, {
    method: 'PUT',
    body: new Blob([args.bytes.slice()]),
    headers: { 'content-type': args.mediaType },
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error(`the upload failed with ${response.status}`)
    args.onProgress(1)
  })

  return { done, abort: () => controller.abort() }
}

export const putImageOf =
  (put: typeof putBytes): PutImage =>
  (args) =>
    put({
      url: args.url,
      bytes: args.bytes,
      mediaType: args.mediaType,
      onProgress: args.onProgress,
    })
