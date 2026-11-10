import type { KeyboardMetrics, PlatformOSType } from 'react-native'

const DOCKED_SLACK = 4

export const keyboardInsetOf = ({
  frame,
  platform,
  windowHeight,
}: {
  frame: KeyboardMetrics
  platform: PlatformOSType
  windowHeight: number
}): number => {
  if (frame.height <= 0) return 0
  if (platform !== 'ios') return frame.height
  const docked = Math.abs(frame.screenY + frame.height - windowHeight) <= DOCKED_SLACK
  return docked ? frame.height : 0
}
