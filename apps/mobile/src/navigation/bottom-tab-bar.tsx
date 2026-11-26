import { usePathname } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { GlassSurface } from './glass-surface'
import { TabButton } from './tab-button'
import { activeTabOf, APP_TABS } from './tabs'

const BOTTOM_GAP = 12

export const BottomTabBar = () => {
  const insets = useSafeAreaInsets()
  const active = activeTabOf(usePathname())
  return (
    <View style={[styles.root, { bottom: insets.bottom + BOTTOM_GAP }]} pointerEvents="box-none">
      <GlassSurface style={styles.bar}>
        {APP_TABS.map((item) => (
          <TabButton key={item.tab} item={item} active={item.tab === active} />
        ))}
      </GlassSurface>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  bar: {
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 52,
    paddingHorizontal: 4,
  },
})
