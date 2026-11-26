import { describeBytes } from '../composer/attachment-plan'
import type { Photo } from './photo-store'

const SEPARATOR = ' · '

const formatOf = (mediaType: string | undefined): string | undefined => {
  const subtype = mediaType?.split('/')[1]?.split('+')[0]
  if (subtype === undefined || subtype.length === 0) return undefined
  return subtype === 'jpeg' ? 'JPEG' : subtype.toUpperCase()
}

const dimensionsOf = (photo: Photo): string | undefined => {
  if (photo.width === undefined || photo.height === undefined) return undefined
  if (photo.width <= 0 || photo.height <= 0) return undefined
  return `${photo.width} × ${photo.height}`
}

const bytesOf = (size: number | undefined): string | undefined =>
  size === undefined || size <= 0 ? undefined : describeBytes(size)

export const photoDetailOf = (photo: Photo): string | undefined => {
  const parts = [formatOf(photo.mediaType), dimensionsOf(photo), bytesOf(photo.size)].filter(
    (part): part is string => part !== undefined,
  )
  return parts.length === 0 ? undefined : parts.join(SEPARATOR)
}
