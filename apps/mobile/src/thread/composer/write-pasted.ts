import { File, Paths } from 'expo-file-system'

import type { PastedImage } from './paste-image'

export const writePasted = async (image: PastedImage): Promise<string> => {
  const file = new File(Paths.cache, image.name)
  if (file.exists) file.delete()
  file.create()
  await file.write(image.base64, { encoding: 'base64' })
  return file.uri
}
