import {
  AtlasMark,
  Avatar,
  EAvatarSize,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  Separator,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { router } from 'expo-router'
import { LogOut, type LucideIcon, MessagesSquare, Settings, SquarePen } from 'lucide-react-native'
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuth } from '../auth/auth-provider'
import { useDrawer } from './drawer-provider'

const DrawerItem = ({
  label,
  icon,
  destructive = false,
  onPress,
}: {
  label: string
  icon: LucideIcon
  destructive?: boolean
  onPress: () => void
}) => {
  const theme = useTheme()
  const color = destructive ? theme.destructive : theme.sidebarForeground
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        pressed ? { backgroundColor: theme.sidebarAccent } : null,
      ]}
    >
      <Icon icon={icon} color={color} size={16} />
      <Text size={ETextRole.Sm} color={color}>
        {label}
      </Text>
    </Pressable>
  )
}

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

const initialsOf = (label: string): string =>
  label
    .split(/[\s@._-]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

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

  const name = user?.name ?? user?.email ?? 'Signed in'

  return (
    <View style={[styles.root, { paddingTop: insets.top + space(3) }]}>
      <View style={styles.wordmark}>
        <AtlasMark size={24} color={theme.primary} />
        <Text size={ETextRole.Lg} family={EFontFamily.Display} weight={EFontWeight.Semibold} tight>
          Atlas
        </Text>
      </View>
      <View style={styles.menu}>
        <DrawerItem label="Sessions" icon={MessagesSquare} onPress={() => handleNavigate('/')} />
        <DrawerItem label="New session" icon={SquarePen} onPress={() => handleNavigate('/new')} />
        <DrawerItem label="Settings" icon={Settings} onPress={() => handleNavigate('/settings')} />
      </View>
      <View style={styles.spacer} />
      <Separator sidebar />
      <View style={[styles.footer, { paddingBottom: insets.bottom + space(2) }]}>
        <View style={styles.account}>
          <Avatar initials={initialsOf(name)} size={EAvatarSize.Sm} />
          <View style={styles.accountText}>
            <Text size={ETextRole.Sm} numberOfLines={1}>
              {name}
            </Text>
            {user?.name !== undefined ? (
              <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>
        <DrawerItem label="Sign out" icon={LogOut} destructive onPress={handleSignOut} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  wordmark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(4),
    paddingBottom: space(3),
  },
  menu: {
    gap: space(0.5),
    paddingHorizontal: space(2),
  },
  item: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(2),
    height: 36,
    paddingHorizontal: space(2),
  },
  spacer: {
    flex: 1,
  },
  footer: {
    gap: space(1),
    paddingHorizontal: space(2),
    paddingTop: space(2),
  },
  account: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    height: 40,
    paddingHorizontal: space(2),
  },
  accountText: {
    flex: 1,
  },
})
