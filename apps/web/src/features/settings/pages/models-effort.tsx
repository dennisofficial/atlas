'use client'

import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import { useModelPicker } from '@/features/threads/data/use-model-picker'
import type { SettingValues } from '@/lib/cloud-settings'

import { activePresetOf, modelsChanges, modelsConfigFrom } from '../data/personal/models-settings'
import { QueryPage } from '../data/personal/query-boundary'
import { usePersonalSettings, useSettingsDraft } from '../data/personal/use-settings-draft'
import {
  EPreset,
  PRESETS,
  PRESET_LABELS,
  ROLE_ORDER,
  type EAgentRole,
  type RoleSetting,
} from '../fixtures/settings-agent'
import { ConfigFooter } from '../parts/agent-config-footer'
import { RoleCard } from '../parts/agent-role-card'
import { SettingsPage, SettingsSection } from '../settings-layout'

const PRESET_ORDER = [EPreset.Fast, EPreset.Balanced, EPreset.Thorough]
const TITLE = 'Models & Effort'
const DESCRIPTION = 'Choose which model each part of the agent runs on and how hard it thinks.'

function isPreset(value: unknown): value is EPreset {
  return PRESET_ORDER.some((preset) => preset === value)
}

export function ModelsEffortPage() {
  const settings = usePersonalSettings()
  return (
    <QueryPage query={settings.query} title={TITLE} description={DESCRIPTION}>
      {(values) => <ModelsEditor values={values} save={settings.save} />}
    </QueryPage>
  )
}

function ModelsEditor({
  values,
  save,
}: {
  values: SettingValues
  save: (changes: Record<string, string | number | boolean | null>) => Promise<void>
}) {
  const { draft, saving, handleSave } = useSettingsDraft({
    values,
    fromValues: modelsConfigFrom,
    toChanges: modelsChanges,
    save,
  })
  const picker = useModelPicker()
  const { value, setValue } = draft
  const activePreset = activePresetOf(value)

  const handlePresetChange = (selected: unknown[]) => {
    const next = selected[0]
    if (isPreset(next)) setValue(PRESETS[next])
  }
  const handleRoleChange = ({ role, setting }: { role: EAgentRole; setting: RoleSetting }) =>
    setValue({ ...value, [role]: setting })

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <SettingsSection
        title="Presets"
        description="Set the main agent, subagents and background calls at once. Editing a role switches this to Custom."
        actions={
          activePreset ? null : (
            <span className="font-mono text-xs text-muted-foreground">Custom</span>
          )
        }
      >
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={activePreset ? [activePreset] : []}
          onValueChange={handlePresetChange}
        >
          {PRESET_ORDER.map((preset) => (
            <ToggleGroupItem key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsSection>
      {ROLE_ORDER.map((role) => (
        <RoleCard
          key={role}
          role={role}
          setting={value[role]}
          picker={picker}
          onChange={(setting) => handleRoleChange({ role, setting })}
        />
      ))}
      <ConfigFooter
        dirty={draft.dirty && !saving}
        onDiscard={draft.discard}
        onSave={() => void handleSave()}
      />
    </SettingsPage>
  )
}
