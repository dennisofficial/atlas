import { EFontWeight, ETextRole } from '@dltech/atlas-ui/tokens'
import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'

import {
  EButtonSize,
  EButtonVariant,
  buttonBoxOf,
  buttonColorsOf,
  isIconSize,
  touchSlopOf,
} from './button-style'
import { Icon } from './icon'
import { Text } from './text'
import { useIsDark, useTheme } from './use-theme'

export interface IButtonProps {
  label: string
  onPress: () => void
  variant?: EButtonVariant
  size?: EButtonSize
  icon?: LucideIcon
  leading?: ReactNode
  disabled?: boolean
  loading?: boolean
  stretch?: boolean
  round?: boolean
}

export const Button = ({
  label,
  onPress,
  variant = EButtonVariant.Default,
  size = EButtonSize.Default,
  icon,
  leading,
  disabled = false,
  loading = false,
  stretch = false,
  round = false,
}: IButtonProps) => {
  const theme = useTheme()
  const dark = useIsDark()
  const iconOnly = isIconSize(size)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      hitSlop={touchSlopOf(size)}
      onPress={onPress}
      style={({ pressed }) => {
        const colors = buttonColorsOf({ variant, theme, dark, pressed })
        return [
          styles.base,
          buttonBoxOf(size),
          round ? styles.round : null,
          stretch ? styles.stretch : null,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            opacity: disabled ? 0.5 : 1,
          },
        ]
      }}
    >
      {({ pressed }) => {
        const { foreground } = buttonColorsOf({ variant, theme, dark, pressed })
        if (loading) return <ActivityIndicator size="small" color={foreground} />
        return (
          <>
            {leading}
            {icon !== undefined ? (
              <Icon icon={icon} color={foreground} size={size === EButtonSize.IconSm ? 14 : 16} />
            ) : null}
            {iconOnly ? null : (
              <Text size={ETextRole.Sm} weight={EFontWeight.Medium} color={foreground}>
                {label}
              </Text>
            )}
          </>
        )
      }}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  round: {
    borderRadius: 999,
  },
  stretch: {
    alignSelf: 'stretch',
  },
})

export { EButtonSize, EButtonVariant }
