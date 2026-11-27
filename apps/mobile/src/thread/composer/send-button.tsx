import { Button, EButtonSize, EButtonVariant } from '@dltech/atlas-ui-native'
import { ArrowUp, type LucideIcon, Square } from 'lucide-react-native'
import Animated, {
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

import { playPressHaptic } from './send-haptic'
import {
  ESendAction,
  type ISendButtonProps,
  PRESSED_SCALE,
  PRESS_IN_SPRING,
  RELEASE_SPRING,
  sendHitSlopOf,
  sendLabelOf,
} from './send-press'

const APPEAR = ZoomIn.springify().damping(12).stiffness(320)

const LOOK: Record<ESendAction, { icon: LucideIcon; variant: EButtonVariant }> = {
  [ESendAction.Send]: { icon: ArrowUp, variant: EButtonVariant.Default },
  [ESendAction.Stop]: { icon: Square, variant: EButtonVariant.Secondary },
}

export const SendButton = ({
  action,
  disabled = false,
  loading = false,
  besidePressable = true,
  onPress,
}: ISendButtonProps) => {
  const scale = useSharedValue(1)
  const bounce = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))

  const handlePressIn = () => {
    playPressHaptic()
    scale.value = withSpring(PRESSED_SCALE, PRESS_IN_SPRING)
  }

  const handlePressOut = () => {
    scale.value = withSpring(1, RELEASE_SPRING)
  }

  return (
    <Animated.View entering={APPEAR} style={bounce}>
      <Button
        label={sendLabelOf({ action, loading })}
        icon={LOOK[action].icon}
        variant={LOOK[action].variant}
        size={EButtonSize.IconSm}
        round
        disabled={disabled}
        loading={loading}
        hitSlop={sendHitSlopOf({ besidePressable })}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      />
    </Animated.View>
  )
}
