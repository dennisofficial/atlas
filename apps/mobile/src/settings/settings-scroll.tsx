import { useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet } from 'react-native'

export const SettingsScroll = ({ children }: { children: ReactNode }) => {
  const theme = useTheme()
  return (
    <ScrollView
      scrollsToTop={false}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.scroll}
    >
      {children}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    alignSelf: 'center',
    gap: space(6),
    maxWidth: 720,
    padding: space(4),
    paddingBottom: space(10),
    width: '100%',
  },
})
