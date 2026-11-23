import { Button, EButtonSize, EButtonVariant, useTheme } from '@dltech/atlas-ui-native'
import { router, Stack } from 'expo-router'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { Platform } from 'react-native'

import { AccountButton } from '../../navigation/account-button'
import { AppHeader } from '../../navigation/app-header'

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
      <Stack.Screen name="new" options={{ title: 'New session', header: renderAppStackHeader }} />
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
  return <AppStack />
}
