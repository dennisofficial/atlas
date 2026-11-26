import { File, Paths } from 'expo-file-system'
import { Share } from 'react-native'

import { dataUriBytesOf, type Photo, shareFileNameOf } from './photo-store'

const localFileOf = async (photo: Photo): Promise<File> => {
  const target = new File(Paths.cache, shareFileNameOf({ name: photo.name, at: Date.now() }))
  const bytes = dataUriBytesOf(photo.uri)
  if (bytes === undefined) return File.downloadFileAsync(photo.uri, target, { idempotent: true })
  target.write(bytes)
  return target
}

export const sharePhoto = async (photo: Photo) => {
  const file = await localFileOf(photo)
  await Share.share({ url: file.uri })
}
