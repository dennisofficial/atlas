import { space } from '@dltech/atlas-ui/tokens'
import { ChevronRight } from 'lucide-react-native'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { withAlpha } from './color'
import { Icon } from './icon'
import { Text } from './text'
import { ETextRole, ETextTone } from './text-style'
import { useTheme } from './use-theme'

export enum ETraceStatus {
  Running = 'running',
  Error = 'error',
  Pending = 'pending',
}

const toneOf = (status: ETraceStatus | undefined): ETextTone =>
  status === ETraceStatus.Error ? ETextTone.Destructive : ETextTone.Muted

export const Trace = ({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) => <View style={[styles.trace, style]}>{children}</View>

export const TraceIcon = ({ children }: { children: ReactNode }) => (
  <View style={styles.icon}>{children}</View>
)

export const TraceLine = ({
  icon,
  title,
  description,
  status,
  trailing,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: string | undefined
  status?: ETraceStatus | undefined
  trailing?: ReactNode
}) => {
  const theme = useTheme()
  return (
    <View style={styles.line}>
      {icon === undefined ? null : <TraceIcon>{icon}</TraceIcon>}
      <Text size={ETextRole.Sm} tone={toneOf(status)} numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {description === undefined || description.length === 0 ? null : (
        <Text
          size={ETextRole.Sm}
          color={withAlpha({ color: theme.mutedForeground, alpha: 0.7 })}
          numberOfLines={1}
          style={styles.description}
        >
          {description}
        </Text>
      )}
      {trailing === undefined ? null : <TraceIcon>{trailing}</TraceIcon>}
    </View>
  )
}

export const Step = ({
  icon,
  title,
  description,
  status,
  defaultOpen,
  autoOpen,
  children,
  contentStyle,
  onPress,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: string | undefined
  status?: ETraceStatus | undefined
  defaultOpen?: boolean
  autoOpen?: boolean
  children?: ReactNode
  contentStyle?: StyleProp<ViewStyle>
  onPress?: (() => void) | undefined
}) => {
  const theme = useTheme()
  const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined)
  const openable = children !== undefined && children !== null
  const expanded = userOpen ?? autoOpen ?? defaultOpen ?? false

  const handlePress = () => {
    if (onPress !== undefined) {
      onPress()
      return
    }
    if (openable) setUserOpen(!expanded)
  }

  const line = (
    <TraceLine
      icon={icon}
      title={title}
      description={description}
      status={status}
      trailing={
        openable ? (
          <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>
            <Icon icon={ChevronRight} color={theme.mutedForeground} size={16} />
          </View>
        ) : undefined
      }
    />
  )

  if (!openable) return line

  return (
    <View style={styles.step}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        hitSlop={{ top: space(2.5), bottom: space(2.5) }}
        onPress={handlePress}
      >
        {line}
      </Pressable>
      {expanded ? (
        <View style={[styles.content, { borderLeftColor: theme.border }, contentStyle]}>
          {children}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  trace: {
    gap: space(2),
    width: '100%',
  },
  step: {
    width: '100%',
  },
  line: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    maxWidth: '100%',
    minHeight: 24,
  },
  icon: {
    alignItems: 'center',
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  title: {
    flexShrink: 1,
  },
  description: {
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  content: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: space(2),
    marginBottom: space(1),
    marginLeft: space(1.75),
    marginTop: space(2),
    paddingLeft: space(4),
    paddingRight: space(1),
  },
})
