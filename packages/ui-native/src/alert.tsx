import { ETextRole, radius, space } from '@dltech/atlas-ui/tokens'
import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { Icon } from './icon'
import { Text } from './text'
import { useTheme } from './use-theme'

export enum EAlertTone {
  Default = 'default',
  Destructive = 'destructive',
}

export const Alert = ({
  icon,
  tone = EAlertTone.Default,
  children,
}: {
  icon: LucideIcon
  tone?: EAlertTone
  children: ReactNode
}) => {
  const theme = useTheme()
  const color = tone === EAlertTone.Destructive ? theme.destructive : theme.cardForeground
  return (
    <View
      accessibilityRole="alert"
      style={[styles.alert, { backgroundColor: theme.card, borderColor: theme.border }]}
    >
      <View style={styles.icon}>
        <Icon icon={icon} color={color} size={16} />
      </View>
      <Text size={ETextRole.Sm} color={color} style={styles.body}>
        {children}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  alert: {
    borderRadius: radius(1),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(2.5),
    paddingVertical: space(2),
  },
  icon: {
    paddingTop: 2,
  },
  body: {
    flex: 1,
  },
})
