import type { PastedImage } from './paste-image'

export const writePasted = async (image: PastedImage): Promise<string> =>
  `data:${image.mediaType};base64,${image.base64}`
