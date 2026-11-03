import { router, Stack, usePathname } from 'expo-router'

import { HeaderButton } from '../../components/header-button'
import { DrawerContent } from '../../drawer/drawer-content'
import { DrawerProvider, useDrawer } from '../../drawer/drawer-provider'
import { useTheme } from '../../theme/use-theme'

const MenuButton = () => {
  const drawer = useDrawer()
  return <HeaderButton label="Open menu" ios="line.3.horizontal" web="menu" onPress={drawer.open} />
}

const NewSessionButton = () => (
  <HeaderButton
    label="New session"
    ios="plus"
    web="add"
    filled
    onPress={() => router.push('/new')}
  />
)

const AppStack = () => {
  const theme = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.foreground,
        headerTitleStyle: { color: theme.foreground },
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Sessions',
          headerLeft: () => <MenuButton />,
          headerRight: () => <NewSessionButton />,
        }}
      />
      <Stack.Screen name="new" options={{ title: 'New session' }} />
      <Stack.Screen name="thread/[id]" options={{ title: '' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  )
}

export default function AppLayout() {
  const pathname = usePathname()
  return (
    <DrawerProvider drawer={<DrawerContent />} swipeEnabled={pathname === '/'}>
      <AppStack />
    </DrawerProvider>
  )
}
