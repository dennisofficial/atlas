import { useTheme } from '@dltech/atlas-ui-native'
import { type ReactNode, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { contentInsetsOf } from './posture'
import { usePosture } from './use-posture'

export const RailContentFrame = ({ children }: { children: ReactNode }) => {
  const theme = useTheme()
  const posture = usePosture()
  const insets = useSafeAreaInsets()
  const contentInsets = useMemo(() => contentInsetsOf({ insets, posture }), [insets, posture])
  return (
    <SafeAreaInsetsContext.Provider value={contentInsets}>
      <View
        style={[styles.root, { paddingRight: posture.railWidth, backgroundColor: theme.sidebar }]}
      >
        {children}
      </View>
    </SafeAreaInsetsContext.Provider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})
