import type { PickedFile } from './attachment-plan'

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i

export type PastedImage = { name: string; mediaType: string; base64: string; size: number }

const byteLengthOf = (base64: string): number => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

const extensionOf = (mediaType: string): string => {
  const subtype = mediaType.split('/')[1]?.toLowerCase() ?? 'png'
  return subtype === 'jpeg' ? 'jpg' : subtype
}

export const pastedImageOf = (args: { data: string; at: number }): PastedImage | null => {
  const match = DATA_URI.exec(args.data.trim())
  const mediaType = match?.[1]?.toLowerCase()
  const base64 = match?.[2]
  if (mediaType === undefined || base64 === undefined || base64.length === 0) return null
  return {
    name: `pasted-${args.at}.${extensionOf(mediaType)}`,
    mediaType,
    base64,
    size: byteLengthOf(base64),
  }
}

export const pickedOfPasted = (args: { image: PastedImage; uri: string }): PickedFile => ({
  name: args.image.name,
  size: args.image.size,
  mediaType: args.image.mediaType,
  uri: args.uri,
})
