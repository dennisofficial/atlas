import { radius, space } from '@dltech/atlas-ui/tokens'
import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { Icon } from './icon'
import { useTheme } from './use-theme'

export const Bubble = ({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) => {
  const theme = useTheme()
  return <View style={[styles.bubble, { backgroundColor: theme.muted }, style]}>{children}</View>
}

export const MessageFooter = ({
  children,
  align = 'start',
  style,
}: {
  children: ReactNode
  align?: 'start' | 'end'
  style?: StyleProp<ViewStyle>
}) => (
  <View style={[styles.footer, align === 'end' ? styles.footerEnd : null, style]}>{children}</View>
)

export const MessageActions = ({ children }: { children: ReactNode }) => (
  <View style={styles.actions}>{children}</View>
)

export const MessageAction = ({
  icon,
  label,
  onPress,
}: {
  icon: LucideIcon
  label: string
  onPress?: (() => void) | undefined
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed ? { backgroundColor: theme.accent } : null]}
    >
      <Icon icon={icon} color={theme.mutedForeground} size={16} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: radius(1.4),
    maxWidth: '80%',
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    minHeight: 24,
  },
  footerEnd: {
    justifyContent: 'flex-end',
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  action: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
})
