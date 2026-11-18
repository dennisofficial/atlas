import {
  isOwnedUpload,
  type MediaPart,
  type MediaUrlResolver,
  type Message,
} from '@dltech/atlas-core'

import type { MediaSigner } from './media-signer'

/**
 * How the model is handed the pictures an event only references: a signed url where it takes one,
 * the bytes themselves where it takes only those, and which hashes the store no longer has.
 */
export type MediaSource = {
  urlsFor(hashes: readonly string[]): Promise<ReadonlyMap<string, string>>
  bytesFor(hashes: readonly string[]): Promise<ReadonlyMap<string, string>>
  missingOf(hashes: readonly string[]): Promise<string[]>
}

const hashesIn = (parts: readonly { type: string }[]): string[] =>
  parts.filter((part): part is MediaPart => part.type === 'media').map((part) => part.media.hash)

const hashesOfMessage = (message: Message): string[] => {
  if (message.role === 'assistant') return []
  if (message.role === 'user') return hashesIn(message.content)
  return message.content.flatMap((result) =>
    result.output.type === 'content' ? hashesIn(result.output.value) : [],
  )
}

export const mediaHashesOf = (messages: readonly Message[]): string[] => [
  ...new Set(messages.flatMap(hashesOfMessage)),
]

export const signerUrls = (args: { signer: MediaSigner; userId: string }): MediaSource => ({
  async urlsFor(hashes) {
    if (hashes.length === 0) return new Map()
    await args.signer.ready()
    const entries = await Promise.all(
      hashes.map(
        async (hash) => [hash, await args.signer.urlOf({ userId: args.userId, hash })] as const,
      ),
    )
    return new Map(entries)
  },
  async bytesFor(hashes) {
    const entries = await Promise.all(
      hashes.map(
        async (hash) => [hash, await args.signer.bytesOf({ userId: args.userId, hash })] as const,
      ),
    )
    return new Map(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null))
  },
  async missingOf(hashes) {
    const present = await Promise.all(
      hashes.map((hash) => args.signer.exists({ userId: args.userId, hash })),
    )
    return hashes.filter((_, index) => present[index] === false)
  },
})

const PRESENT_BLOB_FOR_MS = 60_000

const uploadBlobPresence = (args: {
  signer: MediaSigner
  now: () => number
}): ((pathname: string) => Promise<boolean>) => {
  const absent = new Set<string>()
  const presentUntil = new Map<string, number>()
  return async (pathname) => {
    if (absent.has(pathname)) return false
    const now = args.now()
    const heldUntil = presentUntil.get(pathname)
    if (heldUntil !== undefined && heldUntil > now) return true
    const size = await args.signer.sizeOf({ pathname })
    if (size === null) {
      absent.add(pathname)
      presentUntil.delete(pathname)
      return false
    }
    presentUntil.set(pathname, now + PRESENT_BLOB_FOR_MS)
    return true
  }
}

export const signerAttachmentUrls = (args: {
  signer: MediaSigner
  userId: string
  now?: (() => number) | undefined
}): MediaUrlResolver => {
  const present = uploadBlobPresence({ signer: args.signer, now: args.now ?? Date.now })
  return {
    async urlOf({ ref }) {
      await args.signer.ready()
      if ('hash' in ref) return args.signer.urlOf({ userId: args.userId, hash: ref.hash })
      if (!isOwnedUpload({ upload: ref, userId: args.userId })) {
        throw new Error(`upload ${ref.uploadId} is not owned by this user`)
      }
      if (!(await present(ref.pathname))) {
        throw new Error(`upload ${ref.uploadId} has no blob at ${ref.pathname}`)
      }
      return args.signer.urlOfPathname({ pathname: ref.pathname })
    },
  }
}

export const attachmentUrlBinding = (args: {
  signer: MediaSigner | undefined
  userId: string
  now?: (() => number) | undefined
}): { mediaUrls?: MediaUrlResolver } =>
  args.signer === undefined
    ? {}
    : {
        mediaUrls: signerAttachmentUrls({
          signer: args.signer,
          userId: args.userId,
          now: args.now,
        }),
      }
