import { Avatar, EAvatarSize } from '@dltech/atlas-ui-native'
import { radius } from '@dltech/atlas-ui/tokens'
import { router } from 'expo-router'
import { Pressable, StyleSheet } from 'react-native'

import { useAuth } from '../auth/auth-provider'
import { HeaderTapShield } from './header-tap-shield'
import { SETTINGS_HREF } from './root-navigation'

export const initialsOf = (label: string): string =>
  label
    .split(/[\s@._-]+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

const HIT_SLOP = 8

export const AccountButton = () => {
  const { user } = useAuth()
  const name = user?.name ?? user?.email ?? 'Signed in'
  const handlePress = () => router.push(SETTINGS_HREF)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      hitSlop={HIT_SLOP}
      onPress={handlePress}
      style={styles.button}
    >
      <Avatar initials={initialsOf(name)} size={EAvatarSize.Sm} />
      <HeaderTapShield slop={HIT_SLOP} />
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
