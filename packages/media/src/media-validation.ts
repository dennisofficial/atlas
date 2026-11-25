import { createHash } from 'node:crypto'
import {
  decodesAsImage,
  EImageDelivery,
  imageMediaType,
  imageSize,
  planInlineDelivery,
  type MediaRef,
} from '@dltech/atlas-core'

export type MediaValidation = { ok: true; media: MediaRef } | { ok: false; reason: string }

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export function validateMediaBytes(args: { hash: string; bytes: Uint8Array }): MediaValidation {
  if (sha256Hex(args.bytes) !== args.hash) {
    return { ok: false, reason: 'the uploaded bytes do not match the hash' }
  }
  const mediaType = imageMediaType(args.bytes)
  if (mediaType === null) return { ok: false, reason: 'the upload is not a supported image' }
  if (!decodesAsImage({ bytes: args.bytes, mediaType })) {
    return { ok: false, reason: 'the image is corrupt' }
  }
  const size = imageSize({ bytes: args.bytes, mediaType })
  if (size === null || size.width < 1 || size.height < 1) {
    return { ok: false, reason: 'the image has no readable size' }
  }
  const plan = planInlineDelivery({
    byteLength: args.bytes.byteLength,
    width: size.width,
    height: size.height,
  })
  if (plan.delivery !== EImageDelivery.Inline) {
    return {
      ok: false,
      reason: `the image cannot be sent to a model: ${plan.reason ?? ''}`.trim(),
    }
  }
  return {
    ok: true,
    media: {
      hash: args.hash,
      mediaType,
      size: args.bytes.byteLength,
      width: size.width,
      height: size.height,
    },
  }
}
