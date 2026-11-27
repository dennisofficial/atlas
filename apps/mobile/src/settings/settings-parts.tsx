import {
  CardList,
  CardRow,
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  Spinner,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { ChevronRight, type LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { EResourceState } from './api-resource-state'

export enum EActionTone {
  Default = 'default',
  Destructive = 'destructive',
}

export const Section = ({ title, children }: { title?: string; children: ReactNode }) => (
  <View style={styles.section}>
    {title === undefined ? null : (
      <Text size={ETextRole.Sm} weight={EFontWeight.Medium} style={styles.sectionTitle}>
        {title}
      </Text>
    )}
    <CardList>{children}</CardList>
  </View>
)

export const Row = ({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) => (
  <CardRow>
    <Text size={ETextRole.Sm}>{label}</Text>
    <Text
      size={ETextRole.Sm}
      tone={ETextTone.Muted}
      family={mono ? EFontFamily.Mono : EFontFamily.Sans}
      numberOfLines={1}
      style={styles.value}
    >
      {value}
    </Text>
  </CardRow>
)

export const NavRow = ({
  label,
  value,
  icon,
  onPress,
}: {
  label: string
  value?: string
  icon?: LucideIcon
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <CardRow>
        <View style={styles.leading}>
          {icon === undefined ? null : <Icon icon={icon} color={theme.foreground} size={16} />}
          <Text size={ETextRole.Sm}>{label}</Text>
        </View>
        <View style={styles.trailing}>
          {value === undefined ? null : (
            <Text size={ETextRole.Sm} tone={ETextTone.Muted} numberOfLines={1} style={styles.value}>
              {value}
            </Text>
          )}
          <Icon icon={ChevronRight} color={theme.mutedForeground} size={16} />
        </View>
      </CardRow>
    </Pressable>
  )
}

export const ActionRow = ({
  label,
  tone = EActionTone.Default,
  onPress,
  loading = false,
}: {
  label: string
  tone?: EActionTone
  onPress: () => void
  loading?: boolean
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading }}
      disabled={loading}
      onPress={onPress}
    >
      <CardRow>
        <Text
          size={ETextRole.Sm}
          tone={tone === EActionTone.Destructive ? ETextTone.Destructive : ETextTone.Foreground}
        >
          {label}
        </Text>
        {loading ? <Spinner color={theme.primary} size={16} /> : null}
      </CardRow>
    </Pressable>
  )
}

export const StatusRows = ({
  state,
  onRetry,
  failure = 'This could not be loaded.',
}: {
  state: EResourceState
  onRetry?: () => void
  failure?: string
}) => {
  const theme = useTheme()
  if (state === EResourceState.Ready) return null
  if (state === EResourceState.Loading) {
    return (
      <View style={styles.status}>
        <Spinner color={theme.primary} size={20} />
      </View>
    )
  }
  return (
    <View style={styles.status}>
      <Text size={ETextRole.Sm} tone={ETextTone.Destructive} style={styles.statusText}>
        {failure}
      </Text>
      {onRetry === undefined ? null : (
        <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={onRetry}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Tap to try again.
          </Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: space(2),
  },
  sectionTitle: {
    paddingHorizontal: space(1),
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
  leading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: space(1),
  },
  status: {
    alignItems: 'center',
    gap: space(2),
    paddingTop: space(10),
  },
  statusText: {
    textAlign: 'center',
  },
})
