import type { IconPath } from '@dltech/atlas-ui/file-icons'

export const iconFillOf = ({
  path,
  colored,
  foreground,
  muted,
}: {
  path: IconPath
  colored: boolean
  foreground: string
  muted: string
}): string => (colored ? (path.fill ?? foreground) : muted)
