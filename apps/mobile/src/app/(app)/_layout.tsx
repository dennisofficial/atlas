import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { router, Stack, usePathname } from 'expo-router'

import { useAuth } from '../../auth/auth-provider'
import { SideInsetLayout, WindowInsetsProvider } from '../../layout/side-inset-frame'
import { PostureProvider } from '../../layout/use-posture'
import { useContentWidth } from '../../layout/use-content-width'
import { barHeaderOptionsOf, usesGlassHeader } from '../../navigation/glass-header'
import { pushedHeaderOptionsOf } from '../../navigation/header-options'
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
  const barWidth = useContentWidth()
  const pushedHeaderOptions = {
    headerBackButtonDisplayMode: 'minimal' as const,
    ...barHeaderOptionsOf({
      glass: usesGlassHeader(),
      background: theme.background,
      foreground: theme.foreground,
    }),
  }
  return (
    <Stack
      screenOptions={{ contentStyle: { backgroundColor: theme.background } }}
      screenLayout={SideInsetLayout}
    >
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
          sheetAllowedDetents: [0.55, 1],
          sheetExpandsWhenScrolledToEdge: false,
          sheetGrabberVisible: true,
          contentStyle: { backgroundColor: usesGlassHeader() ? 'transparent' : theme.background },
        }}
      />
      <Stack.Screen
        name="agents/[agentId]"
        options={{
          ...pushedHeaderOptions,
          ...pushedHeaderOptionsOf({ title: 'Sub-agent', barWidth }),
        }}
      />
      <Stack.Screen
        name="project-settings/[projectId]"
        options={{
          ...pushedHeaderOptions,
          ...pushedHeaderOptionsOf({ title: 'Project settings', barWidth }),
        }}
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
      <Stack.Screen
        name="dictation-lab"
        options={{
          ...pushedHeaderOptions,
          ...pushedHeaderOptionsOf({ title: 'Dictation lab', barWidth }),
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          ...pushedHeaderOptions,
          ...pushedHeaderOptionsOf({ title: 'Settings', barWidth }),
        }}
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
          <WindowInsetsProvider>
            <AppStack />
          </WindowInsetsProvider>
        </InAppNoticesProvider>
      </SessionsDrawerProvider>
    </PostureProvider>
  )
}
