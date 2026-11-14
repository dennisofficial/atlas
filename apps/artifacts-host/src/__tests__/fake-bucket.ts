import type { ArtifactBucket, BucketObject, StoredObject } from '../route-object'

export type FakeBucket = ArtifactBucket & {
  readonly gets: string[]
  write(args: { key: string; text: string }): void
}

const streamOf = (text: string): ReadableStream<Uint8Array> => {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

const etagOf = (text: string): string => {
  const hash = [...new TextEncoder().encode(text)].reduce(
    (accumulated, byte) => (accumulated * 31 + byte) % 0xfffffffb,
    0,
  )
  return `"${hash.toString(16)}"`
}

export const storedObjectOf = (text: string): StoredObject => ({
  body: streamOf(text),
  etag: etagOf(text),
})

const bucketObjectOf = (text: string): BucketObject => ({
  ...storedObjectOf(text),
  httpEtag: etagOf(text),
  text: async () => text,
})

export const fakeBucketOf = (files: Record<string, string> = {}): FakeBucket => {
  const stored = new Map(Object.entries(files))
  const gets: string[] = []
  return {
    gets,
    write: ({ key, text }) => {
      stored.set(key, text)
    },
    get: async (key) => {
      gets.push(key)
      const text = stored.get(key)
      return text === undefined ? null : bucketObjectOf(text)
    },
  }
}
