import { EFontWeight, ETextRole } from '@dltech/atlas-ui/tokens'
import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { type Insets, Pressable, StyleSheet } from 'react-native'

import {
  EButtonSize,
  EButtonVariant,
  buttonBoxOf,
  buttonColorsOf,
  isIconSize,
  touchSlopOf,
} from './button-style'
import { Icon } from './icon'
import { Spinner } from './spinner'
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
  hitSlop?: Insets
  onPressIn?: () => void
  onPressOut?: () => void
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
  hitSlop,
  onPressIn,
  onPressOut,
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
      hitSlop={hitSlop ?? touchSlopOf(size)}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => {
        const colors = buttonColorsOf({ variant, theme, dark, pressed, disabled })
        return [
          styles.base,
          buttonBoxOf(size),
          round ? styles.round : null,
          stretch ? styles.stretch : null,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]
      }}
    >
      {({ pressed }) => {
        const { foreground } = buttonColorsOf({ variant, theme, dark, pressed, disabled })
        if (loading) return <Spinner color={foreground} />
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
