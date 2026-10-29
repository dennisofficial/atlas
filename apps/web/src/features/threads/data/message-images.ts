import type { SaidImage } from '@dltech/atlas-core'
import type { MessageImage } from '@dltech/atlas-ui/ai/message'

const NO_IMAGES: readonly MessageImage[] = []

const fileNameOf = (path: string): string => path.split('/').at(-1) || path

export function messageImagesOf(args: {
  id: string
  images: readonly SaidImage[] | undefined
}): readonly MessageImage[] {
  if (args.images === undefined || args.images.length === 0) return NO_IMAGES
  return args.images.map((image, index) => ({
    id: `${args.id}#image-${index}`,
    src: `data:${image.mediaType};base64,${image.data}`,
    alt: fileNameOf(image.path),
  }))
}
