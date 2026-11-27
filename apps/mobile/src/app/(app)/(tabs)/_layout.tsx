import { useTheme } from '@dltech/atlas-ui-native'
import { usePathname } from 'expo-router'
import { NativeTabs } from 'expo-router/native-tabs'

import { tabBarHiddenOf } from '../../../navigation/root-navigation'
import { APP_TAB_ITEMS, EAppTab } from '../../../navigation/tabs'
import { useSessionsDrawer } from '../../../sessions/sessions-drawer-state'

export default function TabsLayout() {
  const theme = useTheme()
  const pathname = usePathname()
  const { open: drawerOpen } = useSessionsDrawer()
  return (
    <NativeTabs
      hidden={tabBarHiddenOf({ pathname, drawerOpen })}
      tintColor={theme.foreground}
      iconColor={{ default: theme.mutedForeground, selected: theme.foreground }}
    >
      <NativeTabs.Trigger name={EAppTab.Sessions}>
        <NativeTabs.Trigger.Icon sf="bubble.left" />
        <NativeTabs.Trigger.Label>{APP_TAB_ITEMS[EAppTab.Sessions].label}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name={EAppTab.Routines}>
        <NativeTabs.Trigger.Icon sf="calendar.badge.clock" />
        <NativeTabs.Trigger.Label>{APP_TAB_ITEMS[EAppTab.Routines].label}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name={EAppTab.Projects}>
        <NativeTabs.Trigger.Icon sf={{ default: 'folder', selected: 'folder.fill' }} />
        <NativeTabs.Trigger.Label>{APP_TAB_ITEMS[EAppTab.Projects].label}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name={EAppTab.Artifacts}>
        <NativeTabs.Trigger.Icon sf="macwindow" />
        <NativeTabs.Trigger.Label>
          {APP_TAB_ITEMS[EAppTab.Artifacts].label}
        </NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
