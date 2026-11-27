import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { Button, Host, Image } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  animation,
  Animation,
  buttonBorderShape,
  buttonStyle,
  contentTransition,
} from '@expo/ui/swift-ui/modifiers'
import { StyleSheet } from 'react-native'

import type { DictationButtonProps } from './dictation-button-props'

const SIZE = 32

const SYMBOL_SIZE = 16

const SPRING = { response: 0.3, dampingFraction: 0.7 }

export const DictationButton = ({ recording, onPress }: DictationButtonProps) => {
  const theme = useTheme()
  const dark = useIsDark()
  return (
    <Host colorScheme={dark ? 'dark' : 'light'} alignment="center" style={styles.host}>
      <Button
        onPress={onPress}
        modifiers={[
          accessibilityLabel(recording ? 'Stop dictation' : 'Start dictation'),
          buttonStyle('glass'),
          buttonBorderShape('circle'),
        ]}
      >
        <Image
          systemName={recording ? 'stop.fill' : 'mic'}
          size={SYMBOL_SIZE}
          color={theme.foreground}
          modifiers={[
            contentTransition('symbolEffect', { symbolEffect: { effect: 'replace' } }),
            animation(Animation.spring(SPRING), recording),
          ]}
        />
      </Button>
    </Host>
  )
}

const styles = StyleSheet.create({
  host: {
    height: SIZE,
    width: SIZE,
  },
})
