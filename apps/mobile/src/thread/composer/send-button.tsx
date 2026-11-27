import { Icon, Spinner, useTheme } from '@dltech/atlas-ui-native'
import type { SemanticTheme } from '@dltech/atlas-ui/tokens'
import { ArrowUp, type LucideIcon, Square } from 'lucide-react-native'
import { Pressable, StyleSheet } from 'react-native'
import Animated, {
  Easing,
  Keyframe,
  LayoutAnimationConfig,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

import { playPressHaptic } from './send-haptic'
import {
  COLOR_TRANSITION_MS,
  ESendAction,
  ICON_SWAP_FROM_SCALE,
  ICON_SWAP_MS,
  type ISendButtonProps,
  PRESSED_SCALE,
  PRESS_IN_SPRING,
  RELEASE_SPRING,
  SEND_BUTTON_SIZE,
  sendHitSlopOf,
  sendLabelOf,
} from './send-press'

const ICON: Record<ESendAction, LucideIcon> = {
  [ESendAction.Send]: ArrowUp,
  [ESendAction.Stop]: Square,
}

const HIDDEN = { opacity: 0, transform: [{ scale: ICON_SWAP_FROM_SCALE }] }
const SHOWN = { opacity: 1, transform: [{ scale: 1 }] }

const ICON_IN = new Keyframe({
  0: HIDDEN,
  100: { ...SHOWN, easing: Easing.out(Easing.cubic) },
}).duration(ICON_SWAP_MS)

const ICON_OUT = new Keyframe({
  0: SHOWN,
  100: { ...HIDDEN, easing: Easing.in(Easing.cubic) },
}).duration(ICON_SWAP_MS)

const colorsOf = ({
  action,
  muted,
  theme,
}: {
  action: ESendAction
  muted: boolean
  theme: SemanticTheme
}) => {
  if (action === ESendAction.Stop)
    return { background: theme.secondary, foreground: theme.secondaryForeground }
  if (muted) return { background: theme.muted, foreground: theme.mutedForeground }
  return { background: theme.primary, foreground: theme.primaryForeground }
}

export const SendButton = ({
  action,
  disabled = false,
  loading = false,
  besidePressable = true,
  onPress,
}: ISendButtonProps) => {
  const theme = useTheme()
  const scale = useSharedValue(1)
  const bounce = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const colors = colorsOf({ action, muted: disabled, theme })

  const handlePressIn = () => {
    playPressHaptic()
    scale.value = withSpring(PRESSED_SCALE, PRESS_IN_SPRING)
  }

  const handlePressOut = () => {
    scale.value = withSpring(1, RELEASE_SPRING)
  }

  return (
    <Animated.View style={bounce}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sendLabelOf({ action, loading })}
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled || loading}
        hitSlop={sendHitSlopOf({ besidePressable })}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Animated.View
          style={[
            styles.circle,
            {
              backgroundColor: colors.background,
              transitionDuration: COLOR_TRANSITION_MS,
              transitionProperty: 'backgroundColor',
            },
          ]}
        >
          <LayoutAnimationConfig skipEntering skipExiting>
            <Animated.View
              key={loading ? 'loading' : action}
              entering={ICON_IN}
              exiting={ICON_OUT}
              style={styles.glyph}
            >
              {loading ? (
                <Spinner color={colors.foreground} />
              ) : (
                <Icon icon={ICON[action]} color={colors.foreground} size={14} />
              )}
            </Animated.View>
          </LayoutAnimationConfig>
        </Animated.View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    borderRadius: SEND_BUTTON_SIZE / 2,
    height: SEND_BUTTON_SIZE,
    justifyContent: 'center',
    width: SEND_BUTTON_SIZE,
  },
  glyph: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
