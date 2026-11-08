import { base64Bytes, inlineData, visualTokens, type Attachment } from '@dltech/atlas-core'

import { formatTokens } from './theme'

const sized = (attachment: Attachment): string | null => {
  const { width, height } = attachment.image ?? {}
  return width === undefined || height === undefined ? null : `${width}×${height}`
}

const cost = (attachment: Attachment): string | null => {
  const data = inlineData(attachment)
  if (data === undefined) return null
  const tokens = visualTokens({ byteLength: base64Bytes(data), ...attachment.image })
  return tokens === null ? null : `~${formatTokens(tokens)} tokens`
}

/**
 * What a picture that rode along with the message reads as afterwards. The cost is the reason the
 * row exists: an image is spent tokens that the text beside it never accounts for, and the
 * transcript is the only place left to see what it took. The carrier adds its own mark — the
 * attachment chip prefixes `glyph.image` — so the text itself stays glyphless.
 */
export const saidImageText = (attachment: Attachment): string =>
  [attachment.name, sized(attachment), cost(attachment)]
    .filter((part): part is string => part !== null)
    .join(' · ')
