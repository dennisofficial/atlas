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

export const signerAttachmentUrls = (args: {
  signer: MediaSigner
  userId: string
}): MediaUrlResolver => ({
  async urlOf({ ref }) {
    await args.signer.ready()
    if ('hash' in ref) return args.signer.urlOf({ userId: args.userId, hash: ref.hash })
    if (!isOwnedUpload({ upload: ref, userId: args.userId })) {
      throw new Error(`upload ${ref.uploadId} is not owned by this user`)
    }
    return args.signer.urlOfPathname({ pathname: ref.pathname })
  },
})

export const attachmentUrlBinding = (args: {
  signer: MediaSigner | undefined
  userId: string
}): { mediaUrls?: MediaUrlResolver } =>
  args.signer === undefined
    ? {}
    : { mediaUrls: signerAttachmentUrls({ signer: args.signer, userId: args.userId }) }
