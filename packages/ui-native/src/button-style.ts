import { type SemanticTheme, radius, space } from '@dltech/atlas-ui/tokens'

import { withAlpha } from './color'

export enum EButtonVariant {
  Default = 'default',
  Outline = 'outline',
  Secondary = 'secondary',
  Ghost = 'ghost',
  Destructive = 'destructive',
}

export enum EButtonSize {
  Sm = 'sm',
  Default = 'default',
  Lg = 'lg',
  IconSm = 'icon-sm',
  Icon = 'icon',
  IconLg = 'icon-lg',
}

export const MIN_TOUCH_TARGET = 44

const HEIGHT: Record<EButtonSize, number> = {
  [EButtonSize.Sm]: 32,
  [EButtonSize.Default]: 36,
  [EButtonSize.Lg]: MIN_TOUCH_TARGET,
  [EButtonSize.IconSm]: 32,
  [EButtonSize.Icon]: 36,
  [EButtonSize.IconLg]: MIN_TOUCH_TARGET,
}

export const isIconSize = (size: EButtonSize): boolean =>
  size === EButtonSize.IconSm || size === EButtonSize.Icon || size === EButtonSize.IconLg

export const buttonBoxOf = (size: EButtonSize) => {
  const height = HEIGHT[size]
  if (isIconSize(size))
    return { height, width: height, borderRadius: radius(size === EButtonSize.IconSm ? 0.8 : 1) }
  return {
    height,
    paddingHorizontal: size === EButtonSize.Lg ? space(4) : space(3),
    gap: space(size === EButtonSize.Sm ? 1 : 1.5),
    borderRadius: radius(size === EButtonSize.Sm ? 0.8 : 1),
  }
}

export const touchSlopOf = (size: EButtonSize) => Math.max(0, (MIN_TOUCH_TARGET - HEIGHT[size]) / 2)

export const buttonColorsOf = ({
  variant,
  theme,
  dark,
  pressed,
}: {
  variant: EButtonVariant
  theme: SemanticTheme
  dark: boolean
  pressed: boolean
}): { background: string; foreground: string; border: string } => {
  const clear = 'transparent'
  if (variant === EButtonVariant.Default) {
    return {
      background: pressed ? withAlpha({ color: theme.primary, alpha: 0.8 }) : theme.primary,
      foreground: theme.primaryForeground,
      border: clear,
    }
  }
  if (variant === EButtonVariant.Outline) {
    const rest = dark ? withAlpha({ color: theme.input, alpha: 0.3 }) : theme.background
    const hover = dark ? withAlpha({ color: theme.input, alpha: 0.5 }) : theme.muted
    return {
      background: pressed ? hover : rest,
      foreground: theme.foreground,
      border: dark ? theme.input : theme.border,
    }
  }
  if (variant === EButtonVariant.Secondary) {
    return {
      background: pressed ? theme.muted : theme.secondary,
      foreground: theme.secondaryForeground,
      border: clear,
    }
  }
  if (variant === EButtonVariant.Destructive) {
    const base = dark ? 0.2 : 0.1
    return {
      background: withAlpha({ color: theme.destructive, alpha: pressed ? base + 0.1 : base }),
      foreground: theme.destructive,
      border: clear,
    }
  }
  const hover = dark ? withAlpha({ color: theme.muted, alpha: 0.5 }) : theme.muted
  return { background: pressed ? hover : clear, foreground: theme.foreground, border: clear }
}
