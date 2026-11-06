import type { MediaPart, Message } from '@dltech/atlas-core'

import type { MediaSigner } from './media-signer'

export type MediaUrlSource = {
  urlsFor(hashes: readonly string[]): Promise<ReadonlyMap<string, string>>
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

export const signerUrls = (args: { signer: MediaSigner; userId: string }): MediaUrlSource => ({
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
})
