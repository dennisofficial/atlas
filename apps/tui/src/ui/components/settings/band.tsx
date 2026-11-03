import type { ResolvedSetting, SettingsResolution } from '@dltech/atlas-core'
import React from 'react'

import type { Appearance } from '../../appearance'
import { theme } from '../../theme'
import { previewFor } from './previews'

const BAND_MARGIN = 2

const BAND_BORDER = 1

const BAND_PAD = 2

export const BAND_CHROME = (BAND_MARGIN + BAND_BORDER + BAND_PAD) * 2

export function SettingsBand(props: {
  width: number
  setting: ResolvedSetting | undefined
  appearance: Appearance
  resolution: SettingsResolution
}): React.ReactNode {
  const setting = props.setting
  if (setting === undefined) return null

  const preview = previewFor(setting.definition.id)
  if (preview === undefined) return null

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      marginLeft={BAND_MARGIN}
      marginRight={BAND_MARGIN}
      paddingLeft={BAND_PAD}
      paddingRight={BAND_PAD}
      backgroundColor={theme.panelBg}
      border
      borderColor={theme.rule}
    >
      {preview.render({
        width: Math.max(0, props.width - BAND_CHROME),
        appearance: props.appearance,
        setting,
        resolution: props.resolution,
      })}
    </box>
  )
}
