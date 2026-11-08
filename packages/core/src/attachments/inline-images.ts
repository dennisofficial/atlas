import type { SaidImage } from './legacy-said'
import { inlineData, isImage, type Attachment } from './attachment'

export const inlineImagesOf = (attachments: readonly Attachment[]): SaidImage[] =>
  attachments.flatMap((attachment): SaidImage[] => {
    const data = inlineData(attachment)
    if (data === undefined || !isImage(attachment)) return []
    return [
      {
        path: attachment.source ?? attachment.name,
        mediaType: attachment.mediaType,
        data,
        ...(attachment.image?.width === undefined ? {} : { width: attachment.image.width }),
        ...(attachment.image?.height === undefined ? {} : { height: attachment.image.height }),
      },
    ]
  })
