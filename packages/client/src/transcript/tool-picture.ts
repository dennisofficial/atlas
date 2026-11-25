import type { EventOfType, MediaRef } from '@dltech/atlas-core'

export type ToolPicture = { kind: 'media'; media: MediaRef }

export const firstPictureIn = (args: {
  parts: EventOfType<'tool-result'>['modelParts']
}): ToolPicture | undefined => {
  if (args.parts === undefined) return undefined

  for (const part of args.parts) {
    if (part === undefined) continue
    if (part.type === 'media') return { kind: 'media', media: part.media }
  }

  return undefined
}
