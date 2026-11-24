import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { router, Stack, usePathname } from 'expo-router'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { EControlsPlacement } from '../../layout/posture'
import { RailContentFrame } from '../../layout/rail-content-frame'
import { PostureProvider, usePosture } from '../../layout/use-posture'
import { AccountButton } from '../../navigation/account-button'
import { AppControls } from '../../navigation/app-controls'
import { NewSessionButton } from '../../navigation/new-session-button'
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
  const rail = usePosture().controls === EControlsPlacement.Rail
  const headerLeft = rail ? undefined : () => <AccountButton />
  const headerRight = () => <NewSessionButton />
  const tabContentStyle = { backgroundColor: theme.sidebar }
  const pushedHeaderOptions = {
    headerBackButtonDisplayMode: 'minimal' as const,
    headerStyle: { backgroundColor: theme.background },
    headerTintColor: theme.foreground,
  }
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Threads',
          animation: 'none',
          headerLargeTitle: Platform.OS === 'ios',
          headerLeft,
          headerRight,
          contentStyle: tabContentStyle,
        }}
      />
      <Stack.Screen
        name="routines"
        options={{
          title: 'Routines',
          animation: 'none',
          headerLargeTitle: Platform.OS === 'ios',
          headerLeft,
          headerRight,
          contentStyle: tabContentStyle,
        }}
      />
      <Stack.Screen
        name="projects"
        options={{
          title: 'Projects',
          animation: 'none',
          headerLargeTitle: Platform.OS === 'ios',
          headerLeft,
          headerRight,
          contentStyle: tabContentStyle,
        }}
      />
      <Stack.Screen
        name="artifacts"
        options={{
          title: 'Artifacts',
          animation: 'none',
          headerLargeTitle: Platform.OS === 'ios',
          headerLeft,
          headerRight,
          contentStyle: tabContentStyle,
        }}
      />
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
