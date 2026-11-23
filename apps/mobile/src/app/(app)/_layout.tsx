import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { router, Stack, usePathname } from 'expo-router'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { Platform } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { AccountButton } from '../../navigation/account-button'
import { AppHeader } from '../../navigation/app-header'
import { InAppNoticesProvider } from '../../notifications/in-app-notices-provider'
import { sessionIdOfPathname } from '../../thread/v2/presence-state'
import { usePresenceReport } from '../../thread/v2/use-presence-report'

const BackButton = () => (
  <Button
    label="Back"
    icon={ChevronLeft}
    variant={EButtonVariant.Ghost}
    size={EButtonSize.IconLg}
    onPress={() => router.back()}
  />
)

const NewSessionButton = () => (
  <Button
    label="New session"
    icon={Plus}
    variant={EButtonVariant.Ghost}
    size={EButtonSize.IconLg}
    onPress={() => router.push('/new')}
  />
)

const CancelButton = () => (
  <Button
    label="Cancel"
    variant={EButtonVariant.Ghost}
    size={EButtonSize.Sm}
    onPress={() => router.back()}
  />
)

const AppStackHeader = ({ options }: { options: { title?: string } }) => {
  const theme = useTheme()
  return <AppHeader title={options.title ?? ''} left={<BackButton />} surface={theme.background} />
}

const renderAppStackHeader = ({ options }: { options: { title?: string } }) => (
  <AppStackHeader options={options} />
)

const AppStack = () => {
  const theme = useTheme()
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Threads',
          headerLargeTitle: Platform.OS === 'ios',
          headerLeft: () => <AccountButton />,
          headerRight: () => <NewSessionButton />,
          contentStyle: { backgroundColor: theme.sidebar },
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
      <Stack.Screen name="sessions/[id]" options={{ title: '', header: renderAppStackHeader }} />
      <Stack.Screen
        name="agents/[agentId]"
        options={{ title: 'Sub-agent', header: renderAppStackHeader }}
      />
      <Stack.Screen name="settings" options={{ title: 'Settings', header: renderAppStackHeader }} />
    </Stack>
  )
}

export default function AppLayout() {
  const pathname = usePathname()
  const { api } = useAuth()
  usePresenceReport({ api, sessionId: sessionIdOfPathname(pathname) })
  return (
    <InAppNoticesProvider>
      <AppStack />
    </InAppNoticesProvider>
  )
}
