import type { EventOfType, MediaRef } from '@dltech/atlas-core'

export type ToolPicture =
  | { kind: 'inline'; data: string; mediaType: string }
  | { kind: 'media'; media: MediaRef }
  | {
      kind: 'withheld'
      threadId: string
      seq: number
      part: number
      mediaType: string
      width?: number | undefined
      height?: number | undefined
    }

export const firstPictureIn = (args: {
  parts: EventOfType<'tool-result'>['modelParts']
  threadId: string
  seq: number
}): ToolPicture | undefined => {
  if (args.parts === undefined) return undefined

  for (let index = 0; index < args.parts.length; index += 1) {
    const part = args.parts[index]
    if (part === undefined) continue
    if (part.type === 'media') return { kind: 'media', media: part.media }
    if (part.type !== 'image' || part.mediaType.length === 0) continue
    if (part.bytes.kind === 'inline' && part.bytes.data.length > 0)
      return { kind: 'inline', data: part.bytes.data, mediaType: part.mediaType }
    if (part.bytes.kind === 'withheld')
      return {
        kind: 'withheld',
        threadId: args.threadId,
        seq: args.seq,
        part: index,
        mediaType: part.mediaType,
        ...(part.width === undefined ? {} : { width: part.width }),
        ...(part.height === undefined ? {} : { height: part.height }),
      }
  }

  return undefined
}
