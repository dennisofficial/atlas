import { space } from '@dltech/atlas-ui/tokens'
import type { Insets } from 'react-native'

export const CONTROLS_GAP = space(2)
export const CONTROLS_PADDING_TOP = space(1.5)
export const CONTROLS_PADDING_BOTTOM = space(2)

export const SEND_BUTTON_SIZE = 32
const MIN_TOUCH_TARGET = 44
const DEFAULT_SLOP = (MIN_TOUCH_TARGET - SEND_BUTTON_SIZE) / 2

const REACH = space(3)

export const sendHitSlopOf = ({
  besidePressable,
}: {
  besidePressable: boolean
}): Required<Insets> => ({
  top: REACH,
  left: besidePressable ? DEFAULT_SLOP : REACH,
  bottom: DEFAULT_SLOP,
  right: DEFAULT_SLOP,
})

export interface ISpring {
  damping: number
  stiffness: number
  mass: number
}

export const dampingRatioOf = (spring: ISpring): number =>
  spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass))

export const COLOR_TRANSITION_MS = 200

export const ICON_SWAP_MS = 180

export const ICON_SWAP_FROM_SCALE = 0.5

export const PRESSED_SCALE = 1.08
export const PRESS_IN_SPRING: ISpring = { damping: 17, stiffness: 400, mass: 0.5 }
export const RELEASE_SPRING: ISpring = { damping: 28, stiffness: 400, mass: 0.5 }

export enum ESendAction {
  Send = 'send',
  Stop = 'stop',
}

export interface ISendButtonProps {
  action: ESendAction
  disabled?: boolean
  loading?: boolean
  besidePressable?: boolean
  onPress: () => void
}

export const sendLabelOf = ({ action, loading }: { action: ESendAction; loading: boolean }) => {
  if (action === ESendAction.Stop) return 'Stop'
  return loading ? 'Sending…' : 'Send'
}
