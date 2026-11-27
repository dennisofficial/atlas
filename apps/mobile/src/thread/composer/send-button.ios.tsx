import { Spinner, useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { Button, Host, Image, RNHostView } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  contentShape,
  disabled as disabledWhen,
  onTapGesture,
  padding,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { isLiquidGlassAvailable } from 'expo-glass-effect'
import type { Insets } from 'react-native'

import { FallbackSendButton } from './send-button-fallback'
import { playPressHaptic } from './send-haptic'
import { ESendAction, type ISendButtonProps, sendHitSlopOf, sendLabelOf } from './send-press'

const SIZE = 32

const SYMBOL = {
  [ESendAction.Send]: 'arrow.up',
  [ESendAction.Stop]: 'stop.fill',
} as const

const GLASS = {
  [ESendAction.Send]: 'glassProminent',
  [ESendAction.Stop]: 'glass',
} as const

export const SendButton = (props: ISendButtonProps) => {
  if (!isLiquidGlassAvailable()) return <FallbackSendButton {...props} />
  return <GlassSendButton {...props} />
}

const GlassSendButton = ({
  action,
  disabled = false,
  loading = false,
  besidePressable = true,
  onPress,
}: ISendButtonProps) => {
  const theme = useTheme()
  const slop = sendHitSlopOf({ besidePressable })
  const dark = useIsDark()
  const prominent = action === ESendAction.Send
  const foreground = prominent ? theme.primaryForeground : theme.foreground

  const handlePress = () => {
    playPressHaptic()
    onPress()
  }

  return (
    <Host colorScheme={dark ? 'dark' : 'light'} alignment="center" style={hostStyleOf(slop)}>
      <Button
        onPress={handlePress}
        modifiers={[
          accessibilityLabel(sendLabelOf({ action, loading })),
          buttonStyle(GLASS[action]),
          buttonBorderShape('circle'),
          ...(prominent ? [tint(theme.primary)] : []),
          padding({
            top: slop.top,
            leading: slop.left,
            bottom: slop.bottom,
            trailing: slop.right,
          }),
          contentShape(shapes.rectangle()),
          onTapGesture(handlePress),
          disabledWhen(disabled || loading),
        ]}
      >
        {loading ? (
          <RNHostView matchContents>
            <Spinner color={foreground} />
          </RNHostView>
        ) : (
          <Image
            systemName={SYMBOL[action]}
            size={16}
            color={disabled ? theme.mutedForeground : foreground}
          />
        )}
      </Button>
    </Host>
  )
}

const hostStyleOf = (slop: Required<Insets>) => ({
  height: SIZE + slop.top + slop.bottom,
  marginBottom: -slop.bottom,
  marginLeft: -slop.left,
  marginRight: -slop.right,
  marginTop: -slop.top,
  width: SIZE + slop.left + slop.right,
})
