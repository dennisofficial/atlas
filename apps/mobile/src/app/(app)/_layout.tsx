import { NativeTabs } from 'expo-router/native-tabs'

export default function AppTabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'bubble.left.and.bubble.right',
            selected: 'bubble.left.and.bubble.right.fill',
          }}
          md="forum"
        />
        {/* biome-ignore lint/correctness/noReactNativeRawText: NativeTabs.Trigger.Label renders the tab-bar label natively */}
        <NativeTabs.Trigger.Label>Sessions</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gear', selected: 'gear' }} md="settings" />
        {/* biome-ignore lint/correctness/noReactNativeRawText: NativeTabs.Trigger.Label renders the tab-bar label natively */}
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
