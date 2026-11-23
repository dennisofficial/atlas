import { useEffect, useMemo } from 'react'

import type { SettingsResolution } from '@dltech/atlas-core'

import { appearanceOf, applyAppearance, type Appearance } from '../ui/appearance'

export function useAppearance(args: { resolution: SettingsResolution }): Appearance {
  const { accent, density, composer, imageRows, fenceWrap, logo } = appearanceOf({
    resolution: args.resolution,
  })

  const appearance = useMemo(
    () => ({ accent, density, composer, imageRows, fenceWrap, logo }),
    [accent, composer, density, imageRows, fenceWrap, logo],
  )

  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance])

  return appearance
}
