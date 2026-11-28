import { bytesOfBase64 } from '@dltech/atlas-client/settings'

export const downloadSkillFile = async ({ path, content }: { path: string; content: string }) => {
  const url = URL.createObjectURL(new Blob([bytesOfBase64(content)]))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = path.split('/').at(-1) ?? path
  anchor.click()
  URL.revokeObjectURL(url)
}
