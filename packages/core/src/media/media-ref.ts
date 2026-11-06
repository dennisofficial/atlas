import { z } from 'zod'

import {
  MAX_INLINE_BYTES,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  type SupportedImageMediaType,
} from '../images/limits'

export type MediaRef = {
  hash: string
  mediaType: SupportedImageMediaType
  size: number
  width: number
  height: number
}

export const mediaRefSchema = z.strictObject({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  mediaType: z.enum(SUPPORTED_IMAGE_MEDIA_TYPES),
  size: z.number().int().positive().max(MAX_INLINE_BYTES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
