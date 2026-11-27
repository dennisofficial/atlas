import { colorSchemeOf, type ETheme } from '@dltech/atlas-client/settings'
import { Appearance } from 'react-native'

type TOptionalSchemeSetter = {
  setColorScheme?: (scheme: 'dark' | 'light' | 'unspecified') => void
}

export const applyThemeMode = (theme: ETheme): void => {
  const appearance: TOptionalSchemeSetter = Appearance
  appearance.setColorScheme?.(colorSchemeOf(theme))
}
