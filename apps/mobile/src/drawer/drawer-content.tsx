import { router } from 'expo-router'
import type { AndroidSymbol, SFSymbol } from 'expo-symbols'
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuth } from '../auth/auth-provider'
import { Icon } from '../components/icon'
import { useTheme } from '../theme/use-theme'
import { useDrawer } from './drawer-provider'

const DrawerItem = ({
  label,
  ios,
  web,
  color,
  onPress,
}: {
  label: string
  ios: SFSymbol
  web: AndroidSymbol
  color: string
  onPress: () => void
}) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [styles.item, { opacity: pressed ? 0.5 : 1 }]}
  >
    <Icon ios={ios} web={web} color={color} />
    <Text style={[styles.itemLabel, { color }]}>{label}</Text>
  </Pressable>
)

const confirmSignOut = (signOut: () => void) => {
  if (Platform.OS !== 'web') {
    Alert.alert('Sign out', 'Sign out of Atlas on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ])
    return
  }
  if (window.confirm('Sign out of Atlas on this device?')) signOut()
}

export const DrawerContent = () => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { user, signOut } = useAuth()
  const drawer = useDrawer()

  const handleNavigate = (target: '/' | '/new' | '/settings') => {
    drawer.close()
    if (target === '/') router.dismissTo('/')
    else router.navigate(target)
  }

  const handleSignOut = () => {
    drawer.close()
    confirmSignOut(() => void signOut())
  }

  const initial = (user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.account}>
        <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
          <Text style={[styles.avatarLabel, { color: theme.primaryForeground }]}>{initial}</Text>
        </View>
        <View style={styles.accountText}>
          {user?.name !== undefined ? (
            <Text numberOfLines={1} style={[styles.name, { color: theme.sidebarForeground }]}>
              {user.name}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={{ color: theme.mutedForeground }}>
            {user?.email ?? 'Signed in'}
          </Text>
        </View>
      </View>
      <View style={[styles.divider, { backgroundColor: theme.sidebarBorder }]} />
      <DrawerItem
        label="Sessions"
        ios="bubble.left.and.bubble.right"
        web="forum"
        color={theme.sidebarForeground}
        onPress={() => handleNavigate('/')}
      />
      <DrawerItem
        label="New session"
        ios="square.and.pencil"
        web="edit_square"
        color={theme.sidebarForeground}
        onPress={() => handleNavigate('/new')}
      />
      <DrawerItem
        label="Settings"
        ios="gearshape"
        web="settings"
        color={theme.sidebarForeground}
        onPress={() => handleNavigate('/settings')}
      />
      <View style={styles.spacer} />
      <DrawerItem
        label="Sign out"
        ios="rectangle.portrait.and.arrow.right"
        web="logout"
        color={theme.destructive}
        onPress={handleSignOut}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 12,
  },
  account: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 8,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  accountText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 8,
    marginVertical: 16,
  },
  item: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 14,
    minHeight: 48,
    paddingHorizontal: 8,
  },
  itemLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  spacer: {
    flex: 1,
  },
})
