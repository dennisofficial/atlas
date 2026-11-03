export const REM_PX = 16

export const spacingUnit = 4

export const radiusPx = 10

export enum ETextRole {
  Xs = 'xs',
  Sm = 'sm',
  Base = 'base',
  Lg = 'lg',
  Xl = 'xl',
  Display = 'display',
}

export const typeScale = {
  [ETextRole.Xs]: { fontSize: 12, lineHeight: 16 },
  [ETextRole.Sm]: { fontSize: 14, lineHeight: 20 },
  [ETextRole.Base]: { fontSize: 16, lineHeight: 24 },
  [ETextRole.Lg]: { fontSize: 18, lineHeight: 28 },
  [ETextRole.Xl]: { fontSize: 20, lineHeight: 28 },
  [ETextRole.Display]: { fontSize: 28, lineHeight: 34 },
} as const satisfies Record<ETextRole, { fontSize: number; lineHeight: number }>

export enum EFontFamily {
  Sans = 'sans',
  Mono = 'mono',
  Display = 'display',
}

export enum EFontWeight {
  Regular = 'regular',
  Medium = 'medium',
  Semibold = 'semibold',
}

export const fontFaceNames = {
  [EFontFamily.Sans]: {
    [EFontWeight.Regular]: 'Geist_400Regular',
    [EFontWeight.Medium]: 'Geist_500Medium',
    [EFontWeight.Semibold]: 'Geist_600SemiBold',
  },
  [EFontFamily.Mono]: {
    [EFontWeight.Regular]: 'JetBrainsMono_400Regular',
    [EFontWeight.Medium]: 'JetBrainsMono_500Medium',
    [EFontWeight.Semibold]: 'JetBrainsMono_600SemiBold',
  },
  [EFontFamily.Display]: {
    [EFontWeight.Regular]: 'SpaceGrotesk_400Regular',
    [EFontWeight.Medium]: 'SpaceGrotesk_500Medium',
    [EFontWeight.Semibold]: 'SpaceGrotesk_600SemiBold',
  },
} as const satisfies Record<EFontFamily, Record<EFontWeight, string>>

export const space = (steps: number): number => steps * spacingUnit

export const radius = (factor: number): number => Math.round(radiusPx * factor)

export type FontFaceName = (typeof fontFaceNames)[EFontFamily][EFontWeight]
