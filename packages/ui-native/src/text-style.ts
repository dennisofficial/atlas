import {
  EFontFamily,
  EFontWeight,
  ETextRole,
  type SemanticTheme,
  fontFaceNames,
  typeScale,
} from '@dltech/atlas-ui/tokens'

export enum ETextTone {
  Foreground = 'foreground',
  Muted = 'muted',
  Primary = 'primary',
  OnPrimary = 'on-primary',
  Destructive = 'destructive',
  Warning = 'warning',
  Sidebar = 'sidebar',
}

const TIGHT_EM = -0.025

export const textStyleOf = ({
  role,
  family,
  weight,
  tight,
}: {
  role: ETextRole
  family: EFontFamily
  weight: EFontWeight
  tight: boolean
}) => {
  const { fontSize, lineHeight } = typeScale[role]
  return {
    fontSize,
    lineHeight,
    fontFamily: fontFaceNames[family][weight],
    letterSpacing: tight ? fontSize * TIGHT_EM : 0,
  }
}

export const toneColorOf = ({ tone, theme }: { tone: ETextTone; theme: SemanticTheme }): string => {
  if (tone === ETextTone.Muted) return theme.mutedForeground
  if (tone === ETextTone.Primary) return theme.primary
  if (tone === ETextTone.OnPrimary) return theme.primaryForeground
  if (tone === ETextTone.Destructive) return theme.destructive
  if (tone === ETextTone.Warning) return theme.warning
  if (tone === ETextTone.Sidebar) return theme.sidebarForeground
  return theme.foreground
}

export { EFontFamily, EFontWeight, ETextRole }
