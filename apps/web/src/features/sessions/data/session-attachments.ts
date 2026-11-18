import { MAX_MESSAGE_UPLOADS } from '@dltech/atlas-core'

import { isImageFile } from '@/features/threads/data/composer-images'

export function routeAttachments(args: { files: readonly File[]; held: number }): {
  images: File[]
  others: File[]
  droppedOverflow: boolean
} {
  const room = Math.max(0, MAX_MESSAGE_UPLOADS - args.held)
  const accepted = args.files.slice(0, room)
  return {
    images: accepted.filter(isImageFile),
    others: accepted.filter((file) => !isImageFile(file)),
    droppedOverflow: args.files.length > room,
  }
}
