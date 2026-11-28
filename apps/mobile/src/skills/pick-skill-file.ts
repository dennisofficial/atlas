import { base64OfBytes } from '@dltech/atlas-client/settings'
import * as DocumentPicker from 'expo-document-picker'
import { readBytes } from '../thread/composer/read-bytes'

export const pickSkillFile = async (): Promise<{ name: string; content: string } | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
  })
  if (result.canceled) return null
  const asset = result.assets[0]
  if (!asset) return null
  const bytes = await readBytes({ uri: asset.uri, blob: asset.file })
  return { name: asset.name, content: base64OfBytes(bytes) }
}
