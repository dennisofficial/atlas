import { EDensity, ETheme } from '@dltech/atlas-wire/web'

import {
  diffChanges,
  settingBool,
  settingString,
  settingValue,
  type ISettingChanges,
  type ISettingValues,
} from './setting-values'

export { EDensity, ETheme }

export type IAppearanceSettings = {
  theme: ETheme
  density: EDensity
  codeFontSize: 12 | 13 | 14
  showDiffStat: boolean
  reduceMotion: boolean
}

export const THEMES: readonly ETheme[] = [ETheme.Dark, ETheme.Light, ETheme.System]

export const DENSITIES: readonly EDensity[] = [EDensity.Comfortable, EDensity.Compact]

export const CODE_FONT_SIZES = [
  { value: '12', label: '12 px' },
  { value: '13', label: '13 px' },
  { value: '14', label: '14 px' },
]

export const colorSchemeOf = (theme: ETheme): 'dark' | 'light' | 'unspecified' => {
  if (theme === ETheme.Dark) return 'dark'
  if (theme === ETheme.Light) return 'light'
  return 'unspecified'
}

const APPEARANCE_PREFIX = 'web.appearance.'

const isTheme = (value: string): value is ETheme => THEMES.some((theme) => theme === value)

const isDensity = (value: string): value is EDensity =>
  DENSITIES.some((density) => density === value)

export function appearanceFrom(values: ISettingValues): IAppearanceSettings {
  const theme = settingString({ values, key: `${APPEARANCE_PREFIX}theme` })
  const density = settingString({ values, key: `${APPEARANCE_PREFIX}density` })
  const size = settingValue({ values, key: `${APPEARANCE_PREFIX}codeFontSize` })
  return {
    theme: isTheme(theme) ? theme : ETheme.Dark,
    density: isDensity(density) ? density : EDensity.Comfortable,
    codeFontSize: size === 12 || size === 14 ? size : 13,
    showDiffStat: settingBool({ values, key: `${APPEARANCE_PREFIX}showDiffStat` }),
    reduceMotion: settingBool({ values, key: `${APPEARANCE_PREFIX}reduceMotion` }),
  }
}

const appearanceFlat = (settings: IAppearanceSettings) => ({
  [`${APPEARANCE_PREFIX}theme`]: settings.theme,
  [`${APPEARANCE_PREFIX}density`]: settings.density,
  [`${APPEARANCE_PREFIX}codeFontSize`]: settings.codeFontSize,
  [`${APPEARANCE_PREFIX}showDiffStat`]: settings.showDiffStat,
  [`${APPEARANCE_PREFIX}reduceMotion`]: settings.reduceMotion,
})

export function appearanceChanges(args: {
  saved: IAppearanceSettings
  draft: IAppearanceSettings
}): ISettingChanges {
  return diffChanges({ saved: appearanceFlat(args.saved), draft: appearanceFlat(args.draft) })
}
