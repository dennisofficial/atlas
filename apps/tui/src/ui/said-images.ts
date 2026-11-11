import type { Attachment } from '@dltech/atlas-core'

const sized = (attachment: Attachment): string | null => {
  const { width, height } = attachment.image ?? {}
  return width === undefined || height === undefined ? null : `${width}×${height}`
}

export const saidImageText = (attachment: Attachment): string =>
  [attachment.name, sized(attachment)].filter((part): part is string => part !== null).join(' · ')
