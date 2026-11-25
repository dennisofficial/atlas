import { ETextRole, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { usePathname } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { useSelectedSession } from '../sessions/selected-session'
import { applyNavigation } from './apply-navigation'
import { sessionsTabHrefOf, tabNavigationOf } from './root-navigation'
import { TAB_ICONS } from './tab-icons'
import { EAppTab, type TAppTabItem } from './tabs'

export const TabButton = ({
  item,
  active,
  showLabel = false,
}: {
  item: TAppTabItem
  active: boolean
  showLabel?: boolean
}) => {
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
      style={showLabel ? styles.labelled : styles.rail}
    >
      <View style={[styles.glyph, active ? { backgroundColor: theme.accent } : null]}>
        <Icon icon={TAB_ICONS[item.tab]} color={color} size={20} />
      </View>
      {showLabel ? (
        <Text size={ETextRole.Xs} color={color} numberOfLines={1}>
          {item.label}
        </Text>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  rail: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  labelled: {
    alignItems: 'center',
    gap: space(1) / 2,
    height: 52,
    justifyContent: 'center',
    width: 64,
  },
  glyph: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
})
