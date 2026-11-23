import {
  AtlasMark,
  Button,
  EButtonSize,
  EButtonVariant,
  EFontWeight,
  ETextRole,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { router, Stack, usePathname } from 'expo-router'
import { ChevronLeft, Menu, Plus } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { DrawerContent } from '../../drawer/drawer-content'
import { DrawerProvider, useDrawer } from '../../drawer/drawer-provider'
import { AppHeader } from '../../navigation/app-header'
import { InAppNoticesProvider } from '../../notifications/in-app-notices-provider'
import { sessionIdOfPathname } from '../../thread/v2/presence-state'
import { usePresenceReport } from '../../thread/v2/use-presence-report'

const MenuButton = () => {
  const drawer = useDrawer()
  return (
    <Button
      label="Open menu"
      icon={Menu}
      variant={EButtonVariant.Ghost}
      size={EButtonSize.IconLg}
      onPress={drawer.open}
    />
  )
}

const BackButton = () => (
  <Button
    label="Back"
    icon={ChevronLeft}
    variant={EButtonVariant.Ghost}
    size={EButtonSize.IconLg}
    onPress={() => router.back()}
  />
)

const Wordmark = () => {
  const theme = useTheme()
  return (
    <View style={styles.wordmark}>
      <AtlasMark size={20} color={theme.foreground} />
      <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
        Atlas
      </Text>
    </View>
  )
}

const AppStack = () => {
  const theme = useTheme()
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: theme.background },
        header: ({ options }) => (
          <AppHeader title={options.title ?? ''} left={<BackButton />} surface={theme.background} />
        ),
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          contentStyle: { backgroundColor: theme.sidebar },
          header: () => (
            <AppHeader
              title={<Wordmark />}
              left={<MenuButton />}
              right={
                <Button
                  label="New session"
                  icon={Plus}
                  variant={EButtonVariant.Ghost}
                  size={EButtonSize.IconLg}
                  onPress={() => router.push('/new')}
                />
              }
              surface={theme.sidebar}
            />
          ),
        }}
      />
      <Stack.Screen name="new" options={{ title: 'New session' }} />
      <Stack.Screen name="thread/[id]" options={{ title: '' }} />
      <Stack.Screen name="sessions/[id]" options={{ title: '' }} />
      <Stack.Screen name="agents/[agentId]" options={{ title: 'Sub-agent' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  )
}

export default function AppLayout() {
  const pathname = usePathname()
  const { api } = useAuth()
  usePresenceReport({ api, sessionId: sessionIdOfPathname(pathname) })
  return (
    <DrawerProvider drawer={<DrawerContent />} swipeEnabled={pathname === '/'}>
      <InAppNoticesProvider>
        <AppStack />
      </InAppNoticesProvider>
    </DrawerProvider>
  )
}

const styles = StyleSheet.create({
  wordmark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
  },
})
