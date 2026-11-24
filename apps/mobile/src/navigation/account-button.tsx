import { Avatar, EAvatarSize } from '@dltech/atlas-ui-native'
import { radius } from '@dltech/atlas-ui/tokens'
import { usePathname } from 'expo-router'
import { Pressable, StyleSheet } from 'react-native'

import { useAuth } from '../auth/auth-provider'
import { usePosture } from '../layout/use-posture'
import { applyNavigation } from './apply-navigation'
import { accountNavigationOf } from './root-navigation'

export const initialsOf = (label: string): string =>
  label
    .split(/[\s@._-]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

export const AccountButton = () => {
  const { user } = useAuth()
  const posture = usePosture()
  const pathname = usePathname()
  const name = user?.name ?? user?.email ?? 'Signed in'
  const handlePress = () =>
    applyNavigation(accountNavigationOf({ controls: posture.controls, pathname }))
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={8}
      onPress={handlePress}
      style={styles.button}
    >
      <Avatar initials={initialsOf(name)} size={EAvatarSize.Sm} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: radius(1),
    justifyContent: 'center',
  },
})
