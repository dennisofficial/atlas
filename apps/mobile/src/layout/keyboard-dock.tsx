import type { ReactNode } from 'react'
import { type StyleProp, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useKeyboardInset } from './use-keyboard-inset'

export const KeyboardDock = ({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) => {
  const insets = useSafeAreaInsets()
  const keyboardInset = useKeyboardInset()
  return (
    <View style={[style, { paddingBottom: keyboardInset > 0 ? keyboardInset : insets.bottom }]}>
      {children}
    </View>
  )
}
