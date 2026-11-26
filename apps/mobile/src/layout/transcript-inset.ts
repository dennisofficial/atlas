export const transcriptInsetOf = ({
  dockHeight,
  keyboardInset,
  safeBottom,
}: {
  dockHeight: number
  keyboardInset: number
  safeBottom: number
}): number => dockHeight + Math.max(keyboardInset, safeBottom)

export const nativeBottomInsetOf = ({
  platform,
  safeBottom,
}: {
  platform: string
  safeBottom: number
}): number => (platform === 'ios' ? safeBottom : 0)

export const listBottomPaddingOf = ({
  clearance,
  nativeBottom,
}: {
  clearance: number
  nativeBottom: number
}): number => Math.max(0, clearance - nativeBottom)
