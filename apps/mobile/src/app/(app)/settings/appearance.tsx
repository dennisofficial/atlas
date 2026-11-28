import {
  CODE_FONT_SIZES,
  DENSITIES,
  EDensity,
  ETheme,
  THEMES,
  appearanceChanges,
  appearanceFrom,
  type IAppearanceSettings,
} from '@dltech/atlas-client/settings'

import { ChoiceRow } from '../../../settings/choice-row'
import { Section } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'
import { SwitchRow } from '../../../settings/switch-row'

const THEME_LABELS: Readonly<Record<ETheme, string>> = {
  [ETheme.Dark]: 'Dark',
  [ETheme.Light]: 'Light',
  [ETheme.System]: 'System',
}

const DENSITY_LABELS: Readonly<Record<EDensity, string>> = {
  [EDensity.Comfortable]: 'Comfortable',
  [EDensity.Compact]: 'Compact',
}

const THEME_OPTIONS = THEMES.map((theme) => ({ value: theme, label: THEME_LABELS[theme] }))
const DENSITY_OPTIONS = DENSITIES.map((density) => ({
  value: density,
  label: DENSITY_LABELS[density],
}))

export default function AppearanceScreen() {
  const settings = useSettings()
  const appearance = appearanceFrom(settings.values)

  const save = (next: IAppearanceSettings) => {
    void settings.save(appearanceChanges({ saved: appearance, draft: next })).catch(() => undefined)
  }

  const handleTheme = (theme: ETheme) => save({ ...appearance, theme })
  const handleDensity = (density: EDensity) => save({ ...appearance, density })
  const handleFontSize = (size: string) => {
    const next = Number(size)
    if (next === 12 || next === 13 || next === 14) save({ ...appearance, codeFontSize: next })
  }
  const handleDiffStat = (showDiffStat: boolean) => save({ ...appearance, showDiffStat })
  const handleReduceMotion = (reduceMotion: boolean) => save({ ...appearance, reduceMotion })

  return (
    <SettingsScroll>
      <Section title="Theme">
        <ChoiceRow
          label="Theme"
          detail="Choose the palette used across the app."
          value={appearance.theme}
          options={THEME_OPTIONS}
          onChange={handleTheme}
        />
      </Section>
      <Section title="Display">
        <ChoiceRow
          label="Density"
          detail="Row height in the thread list and tables."
          value={appearance.density}
          options={DENSITY_OPTIONS}
          onChange={handleDensity}
        />
        <ChoiceRow
          label="Code font size"
          detail="Applies to diffs, files, and the terminal."
          value={String(appearance.codeFontSize)}
          options={CODE_FONT_SIZES}
          onChange={handleFontSize}
        />
        <SwitchRow
          label="Show diff stat on thread rows"
          detail="Display +added −removed next to each thread in the sidebar."
          value={appearance.showDiffStat}
          onValueChange={handleDiffStat}
        />
        <SwitchRow
          label="Reduce motion"
          detail="Skip streaming shimmer and panel transitions."
          value={appearance.reduceMotion}
          onValueChange={handleReduceMotion}
        />
      </Section>
    </SettingsScroll>
  )
}
