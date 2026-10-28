import type { PromptAttachment } from '@dltech/atlas-ui/ai/prompt-input'
import { MAX_MESSAGE_IMAGES, type SaidImageWire } from '@dltech/atlas-wire/web'

export const MAX_IMAGE_DATA_CHARS = 3_500_000
export const MAX_IMAGE_EDGE = 2000
export const PNG_DATA_BUDGET_CHARS = 1_500_000
export const JPEG_QUALITY = 0.85

export const TOAST_ONLY_IMAGES = 'Only images are supported'
export const TOAST_TOO_MANY_IMAGES = `Up to ${MAX_MESSAGE_IMAGES} images`
export const TOAST_IMAGES_TOO_LARGE = 'Images are too large'
export const TOAST_UNREADABLE_IMAGE = "Couldn't read that image"

export type HeldImage = { id: string; image: SaidImageWire }

export const isImageFile = (file: File): boolean => file.type.startsWith('image/')

export function planAttach(args: { files: readonly File[]; held: number }): {
  accepted: File[]
  droppedNonImage: boolean
  droppedOverflow: boolean
} {
  const images = args.files.filter(isImageFile)
  const room = Math.max(0, MAX_MESSAGE_IMAGES - args.held)
  return {
    accepted: images.slice(0, room),
    droppedNonImage: images.length < args.files.length,
    droppedOverflow: images.length > room,
  }
}

export const isOverBudget = (images: readonly SaidImageWire[]): boolean =>
  images.length > MAX_MESSAGE_IMAGES ||
  images.reduce((total, image) => total + image.data.length, 0) > MAX_IMAGE_DATA_CHARS

export const chipOf = (held: HeldImage): PromptAttachment => ({
  id: held.id,
  name: held.image.path,
  previewUrl: `data:${held.image.mediaType};base64,${held.image.data}`,
})

export const imagesFieldOf = (images: SaidImageWire[] | undefined): { images?: SaidImageWire[] } =>
  images === undefined || images.length === 0 ? {} : { images }

export const sameImages = (
  left: readonly SaidImageWire[],
  right: readonly SaidImageWire[],
): boolean =>
  left.length === right.length &&
  left.every((image, index) => {
    const other = right[index]
    return other !== undefined && image.path === other.path && image.data === other.data
  })

export function scaledSizeOf(args: { width: number; height: number; maxEdge: number }): {
  width: number
  height: number
} {
  const longEdge = Math.max(args.width, args.height)
  if (longEdge <= args.maxEdge) return { width: args.width, height: args.height }
  const ratio = args.maxEdge / longEdge
  return {
    width: Math.max(1, Math.round(args.width * ratio)),
    height: Math.max(1, Math.round(args.height * ratio)),
  }
}

export function imageNameOf(args: { fileName: string; index: number; mediaType: string }): string {
  const stem = args.fileName.replace(/\.[^./\\]*$/, '') || `pasted-image-${args.index}`
  return `${stem}.${args.mediaType === 'image/jpeg' ? 'jpg' : 'png'}`
}
