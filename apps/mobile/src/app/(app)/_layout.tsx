import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { router, Stack, usePathname } from 'expo-router'
import { StyleSheet, useWindowDimensions, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { RailContentFrame } from '../../layout/rail-content-frame'
import { PostureProvider, usePosture } from '../../layout/use-posture'
import { AppControls } from '../../navigation/app-controls'
import { tabHeaderOptionsOf } from '../../navigation/header-options'
import { InAppNoticesProvider } from '../../notifications/in-app-notices-provider'
import { sessionIdOfPathname } from '../../thread/v2/presence-state'
import { usePresenceReport } from '../../thread/v2/use-presence-report'

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
  const pushedHeaderOptions = {
    headerBackButtonDisplayMode: 'minimal' as const,
    headerStyle: { backgroundColor: theme.background },
    headerTintColor: theme.foreground,
  }
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen name="index" options={tabOptions('Threads')} />
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
      <Stack.Screen name="sessions/[id]" options={{ title: '', ...pushedHeaderOptions }} />
      <Stack.Screen
        name="agents/[agentId]"
        options={{ title: 'Sub-agent', ...pushedHeaderOptions }}
      />
      <Stack.Screen name="settings" options={{ title: 'Settings', ...pushedHeaderOptions }} />
    </Stack>
  )
}

export default function AppLayout() {
  const pathname = usePathname()
  const { api } = useAuth()
  usePresenceReport({ api, sessionId: sessionIdOfPathname(pathname) })
  return (
    <PostureProvider>
      <InAppNoticesProvider>
        <View style={styles.root}>
          <RailContentFrame>
            <AppStack />
          </RailContentFrame>
          <AppControls />
        </View>
      </InAppNoticesProvider>
    </PostureProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})
