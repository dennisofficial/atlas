import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { router, Stack, usePathname } from 'expo-router'

import { useAuth } from '../../auth/auth-provider'
import { PostureProvider } from '../../layout/use-posture'
import { barHeaderOptionsOf, usesGlassHeader } from '../../navigation/glass-header'
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
  const pushedHeaderOptions = {
    headerBackButtonDisplayMode: 'minimal' as const,
    ...barHeaderOptionsOf({
      glass: usesGlassHeader(),
      background: theme.background,
      foreground: theme.foreground,
    }),
  }
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen
        name="new"
        options={{
          title: 'New session',
          presentation: 'modal',
          headerLeft: () => <CancelButton />,
          ...barHeaderOptionsOf({
            glass: usesGlassHeader(),
            background: theme.background,
            foreground: theme.foreground,
          }),
        }}
      />
      <Stack.Screen
        name="model"
        options={{
          presentation: 'formSheet',
          headerShown: false,
          sheetAllowedDetents: [0.55],
          sheetExpandsWhenScrolledToEdge: false,
          sheetGrabberVisible: true,
          contentStyle: { backgroundColor: usesGlassHeader() ? 'transparent' : theme.background },
        }}
      />
      <Stack.Screen
        name="agents/[agentId]"
        options={{ title: 'Sub-agent', ...pushedHeaderOptions }}
      />
      <Stack.Screen
        name="project-settings/[projectId]"
        options={{ title: 'Project settings', ...pushedHeaderOptions }}
      />
      <Stack.Screen
        name="diagram"
        options={{
          title: 'Diagram',
          presentation: 'fullScreenModal',
          ...pushedHeaderOptions,
          ...barHeaderOptionsOf({
            glass: false,
            background: theme.background,
            foreground: theme.foreground,
          }),
        }}
      />
      <Stack.Screen
        name="photo"
        options={{ presentation: 'fullScreenModal', headerShown: false }}
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
      <SessionsDrawerProvider>
        <InAppNoticesProvider>
          <AppStack />
        </InAppNoticesProvider>
      </SessionsDrawerProvider>
    </PostureProvider>
  )
}
