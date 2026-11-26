import { Icon, useTheme } from '@dltech/atlas-ui-native'
import { usePathname } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { useSelectedSession } from '../sessions/selected-session'
import { applyNavigation } from './apply-navigation'
import { sessionsTabHrefOf, tabNavigationOf } from './root-navigation'
import { TAB_ICONS } from './tab-icons'
import { EAppTab, type TAppTabItem } from './tabs'

export const TabButton = ({ item, active }: { item: TAppTabItem; active: boolean }) => {
  const theme = useTheme()
  const pathname = usePathname()
  const selected = useSelectedSession()
  const color = active ? theme.foreground : theme.mutedForeground
  const handlePress = () => {
    const href = item.tab === EAppTab.Sessions ? sessionsTabHrefOf({ selected }) : item.href
    applyNavigation(tabNavigationOf({ href, pathname }))
  }
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onPress={handlePress}
      style={styles.button}
    >
      <View style={[styles.glyph, active ? { backgroundColor: theme.accent } : null]}>
        <Icon icon={TAB_ICONS[item.tab]} color={color} size={20} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  glyph: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
})
