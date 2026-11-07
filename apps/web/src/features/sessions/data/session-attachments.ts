import { MAX_MESSAGE_UPLOADS, SUPPORTED_IMAGE_MEDIA_TYPES } from '@dltech/atlas-core'

export const isModelImage = (file: { type: string }): boolean =>
  SUPPORTED_IMAGE_MEDIA_TYPES.some((supported) => supported === file.type)

export function routeAttachments(args: { files: readonly File[]; held: number }): {
  images: File[]
  others: File[]
  droppedOverflow: boolean
} {
  const room = Math.max(0, MAX_MESSAGE_UPLOADS - args.held)
  const accepted = args.files.slice(0, room)
  return {
    images: accepted.filter(isModelImage),
    others: accepted.filter((file) => !isModelImage(file)),
    droppedOverflow: args.files.length > room,
  }
}
