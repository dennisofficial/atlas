'use client'

import { RadioGroup } from '@dltech/atlas-ui/components/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import {
  APPEARANCE_DEFAULTS,
  CODE_FONT_SIZES,
  EDensity,
  ETheme,
} from '../fixtures/settings-interface'
import { ThemeCard } from '../parts/interface-theme-card'
import {
  SaveFooter,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../settings-layout'
import { useDraft } from '../use-draft'

const THEMES = [ETheme.Dark, ETheme.Light, ETheme.System]

function isTheme(value: unknown): value is ETheme {
  return THEMES.some((theme) => theme === value)
}

export function AppearancePage() {
  const draft = useDraft(APPEARANCE_DEFAULTS)
  const { value, setValue } = draft

  const handleThemeChange = (next: unknown) => {
    if (isTheme(next)) setValue({ ...value, theme: next })
  }

  const handleDensityChange = (next: string[]) => {
    const density = next.find((item) => item === EDensity.Comfortable || item === EDensity.Compact)
    if (density === EDensity.Comfortable || density === EDensity.Compact) {
      setValue({ ...value, density })
    }
  }

  return (
    <SettingsPage title="Appearance" description="How Atlas looks on this device.">
      <SettingsSection title="Theme">
        <RadioGroup
          value={value.theme}
          onValueChange={handleThemeChange}
          className="grid-cols-3 gap-3"
          aria-label="Theme"
        >
          {THEMES.map((theme) => (
            <ThemeCard key={theme} theme={theme} selected={value.theme === theme} />
          ))}
        </RadioGroup>
      </SettingsSection>
      <SettingsSection title="Display">
        <SettingsCard
          footer={<SaveFooter dirty={draft.dirty} onDiscard={draft.discard} onSave={draft.save} />}
        >
          <SettingsRow
            title="Density"
            description="Row height in the thread list and tables."
            control={
              <ToggleGroup
                variant="outline"
                size="sm"
                spacing={0}
                value={[value.density]}
                onValueChange={handleDensityChange}
                aria-label="Density"
              >
                <ToggleGroupItem value={EDensity.Comfortable}>Comfortable</ToggleGroupItem>
                <ToggleGroupItem value={EDensity.Compact}>Compact</ToggleGroupItem>
              </ToggleGroup>
            }
          />
          <SettingsRow
            title="Code font size"
            description="Applies to diffs, files, and the terminal."
            control={
              <Select
                items={CODE_FONT_SIZES}
                value={value.codeFontSize}
                onValueChange={(next) => next && setValue({ ...value, codeFontSize: next })}
              >
                <SelectTrigger size="sm" className="w-24 font-mono" aria-label="Code font size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CODE_FONT_SIZES.map((size) => (
                    <SelectItem key={size.value} value={size.value}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="Show diff stat on thread rows"
            description="Display +added −removed next to each thread in the sidebar."
            control={
              <Switch
                checked={value.showDiffStat}
                onCheckedChange={(checked) => setValue({ ...value, showDiffStat: checked })}
                aria-label="Show diff stat on thread rows"
              />
            }
          />
          <SettingsRow
            title="Reduce motion"
            description="Skip streaming shimmer and panel transitions."
            control={
              <Switch
                checked={value.reduceMotion}
                onCheckedChange={(checked) => setValue({ ...value, reduceMotion: checked })}
                aria-label="Reduce motion"
              />
            }
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
