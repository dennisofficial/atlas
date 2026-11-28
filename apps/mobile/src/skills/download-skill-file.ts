import { bytesOfBase64 } from '@dltech/atlas-client/settings'
import { File, Paths } from 'expo-file-system'
import { Share } from 'react-native'

export const downloadSkillFile = async ({ path, content }: { path: string; content: string }) => {
  const name = path.split('/').at(-1) ?? 'file'
  const file = new File(Paths.cache, `${Date.now()}-${name}`)
  file.write(bytesOfBase64(content))
  await Share.share({ url: file.uri })
}
