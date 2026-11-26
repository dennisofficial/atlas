export const transcriptInsetOf = ({
  dockHeight,
  keyboardInset,
  safeBottom,
}: {
  dockHeight: number
  keyboardInset: number
  safeBottom: number
}): number => dockHeight + Math.max(keyboardInset, safeBottom)
