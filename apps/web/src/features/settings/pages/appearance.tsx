'use client'

import { useEffect } from 'react'

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

import type { SettingValues } from '@/lib/cloud-settings'

import { appearanceChanges, appearanceFrom } from '../data/personal/interface-settings'
import { QueryPage } from '../data/personal/query-boundary'
import { AppearanceSkeleton } from '../skeletons/agent-skeletons'
import { usePersonalSettings, useSettingsDraft } from '../data/personal/use-settings-draft'
import { CODE_FONT_SIZES, EDensity, ETheme } from '../fixtures/settings-interface'
import { ThemeCard } from '../parts/interface-theme-card'
import {
  SaveFooter,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../settings-layout'

const THEMES = [ETheme.Dark, ETheme.Light, ETheme.System]
const TITLE = 'Appearance'
const DESCRIPTION = 'How Atlas looks on this device.'

function isTheme(value: unknown): value is ETheme {
  return THEMES.some((theme) => theme === value)
}

export function AppearancePage() {
  const settings = usePersonalSettings()
  return (
    <QueryPage
      query={settings.query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<AppearanceSkeleton />}
    >
      {(values) => <AppearanceEditor values={values} save={settings.save} />}
    </QueryPage>
  )
}

function AppearanceEditor({
  values,
  save,
}: {
  values: SettingValues
  save: (changes: Record<string, string | number | boolean | null>) => Promise<void>
}) {
  const { draft, saving, handleSave } = useSettingsDraft({
    values,
    fromValues: appearanceFrom,
    toChanges: appearanceChanges,
    save,
  })
  const { value, setValue } = draft
  const savedTheme = appearanceFrom(values).theme

  useEffect(() => {
    const root = document.documentElement
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
    const light = savedTheme === ETheme.Light || (savedTheme === ETheme.System && prefersLight)
    root.classList.toggle('light', light)
  }, [savedTheme])

  const handleThemeChange = (next: unknown) => {
    if (isTheme(next)) setValue({ ...value, theme: next })
  }

  const handleDensityChange = (next: string[]) => {
    const density = next.find((item) => item === EDensity.Comfortable || item === EDensity.Compact)
    if (density === EDensity.Comfortable || density === EDensity.Compact) {
      setValue({ ...value, density })
    }
  }

  const handleFontSizeChange = (next: string | null) => {
    const size = Number(next)
    if (size === 12 || size === 13 || size === 14) setValue({ ...value, codeFontSize: size })
  }

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <SettingsSection title="Theme" description="Choose the palette used across the app.">
        <RadioGroup
          value={value.theme}
          onValueChange={handleThemeChange}
          className="grid-cols-3"
          aria-label="Theme"
        >
          {THEMES.map((theme) => (
            <ThemeCard key={theme} theme={theme} />
          ))}
        </RadioGroup>
      </SettingsSection>
      <SettingsSection title="Display" description="Tune density and how code and motion render.">
        <SettingsCard
          footer={
            <SaveFooter
              dirty={draft.dirty && !saving}
              onDiscard={draft.discard}
              onSave={() => void handleSave()}
            />
          }
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
                value={String(value.codeFontSize)}
                onValueChange={handleFontSizeChange}
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
