import { appearanceFrom } from '@dltech/atlas-client/settings'
import { useEffect } from 'react'

import { applyThemeMode } from '../theme/theme-mode'
import { useSettings } from './settings-provider'

export const ThemeModeSync = () => {
  const settings = useSettings()
  const theme = appearanceFrom(settings.values).theme

  useEffect(() => {
    applyThemeMode(theme)
  }, [theme])

  return null
}
