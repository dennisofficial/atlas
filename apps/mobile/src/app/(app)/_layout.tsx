import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { router, Stack, usePathname } from 'expo-router'
import { StyleSheet, useWindowDimensions, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { RailContentFrame } from '../../layout/rail-content-frame'
import { PostureProvider, usePosture } from '../../layout/use-posture'
import { AppControls } from '../../navigation/app-controls'
import { tabHeaderOptionsOf } from '../../navigation/header-options'
import { ESettingsPlacement, settingsPlacementOf } from '../../navigation/root-navigation'
import { InAppNoticesProvider } from '../../notifications/in-app-notices-provider'
import { SessionsDrawerProvider } from '../../sessions/sessions-drawer-state'
import { sessionIdOfPathname } from '../../thread/session/presence-state'
import { usePresenceReport } from '../../thread/session/use-presence-report'

const CancelButton = () => (
  <Button
    label="Cancel"
    variant={EButtonVariant.Ghost}
    size={EButtonSize.Sm}
    onPress={() => router.back()}
  />
)

const AppStack = () => {
  const theme = useTheme()
  const posture = usePosture()
  const { width: windowWidth } = useWindowDimensions()
  const tabContentStyle = { backgroundColor: theme.sidebar }
  const tabOptions = (title: string) => ({
    ...tabHeaderOptionsOf({ title, posture, windowWidth }),
    animation: 'none' as const,
    contentStyle: tabContentStyle,
  })
  const settingsRootOptions =
    settingsPlacementOf({ controls: posture.controls }) === ESettingsPlacement.Root
      ? { animation: 'none' as const, gestureEnabled: false }
      : {}
  const pushedHeaderOptions = {
    headerBackButtonDisplayMode: 'minimal' as const,
    headerStyle: { backgroundColor: theme.background },
    headerTintColor: theme.foreground,
  }
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="routines" options={tabOptions('Routines')} />
      <Stack.Screen name="projects" options={tabOptions('Projects')} />
      <Stack.Screen name="artifacts" options={tabOptions('Artifacts')} />
      <Stack.Screen
        name="new"
        options={{
          title: 'New session',
          presentation: 'modal',
          headerLeft: () => <CancelButton />,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.foreground,
        }}
      />
      <Stack.Screen
        name="sessions"
        options={{ headerShown: false, animation: 'none', gestureEnabled: false }}
      />
      <Stack.Screen
        name="agents/[agentId]"
        options={{ title: 'Sub-agent', ...pushedHeaderOptions }}
      />
      <Stack.Screen
        name="diagram"
        options={{
          title: 'Diagram',
          presentation: 'fullScreenModal',
          ...pushedHeaderOptions,
        }}
      />
      <Stack.Screen
        name="settings"
        options={{ title: 'Settings', ...pushedHeaderOptions, ...settingsRootOptions }}
      />
    </Stack>
  )
}

export default function AppLayout() {
  const pathname = usePathname()
  const { api } = useAuth()
  usePresenceReport({ api, sessionId: sessionIdOfPathname(pathname) })
  return (
    <PostureProvider>
      <SessionsDrawerProvider>
        <InAppNoticesProvider>
          <View style={styles.root}>
            <RailContentFrame>
              <AppStack />
            </RailContentFrame>
            <AppControls />
          </View>
        </InAppNoticesProvider>
      </SessionsDrawerProvider>
    </PostureProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})
