import { useEffect } from 'react'

import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import {
  DEFAULT_MODELS_CONFIG,
  EDITED_MODELS_CONFIG,
  EPreset,
  PRESETS,
  PRESET_LABELS,
  ROLE_ORDER,
  type EAgentRole,
  type ModelsConfig,
  type RoleSetting,
} from '../../../fixtures/settings-agent'
import { ConfigFooter } from '../parts/agent-config-footer'
import { RoleCard } from '../parts/agent-role-card'
import { SettingsPage, SettingsSection } from '../settings-layout'
import { useDraft } from '../use-draft'

const PRESET_ORDER = [EPreset.Fast, EPreset.Balanced, EPreset.Thorough]

function findActivePreset(config: ModelsConfig): EPreset | null {
  const serialized = JSON.stringify(config)
  return PRESET_ORDER.find((preset) => JSON.stringify(PRESETS[preset]) === serialized) ?? null
}

function isPreset(value: unknown): value is EPreset {
  return PRESET_ORDER.some((preset) => preset === value)
}

export function ModelsEffortPage({ startEdited = false }: { startEdited?: boolean }) {
  const draft = useDraft<ModelsConfig>(DEFAULT_MODELS_CONFIG)
  const { setValue } = draft
  const activePreset = findActivePreset(draft.value)

  useEffect(() => {
    if (startEdited) setValue(EDITED_MODELS_CONFIG)
  }, [startEdited, setValue])

  const handlePresetChange = (selected: unknown[]) => {
    const next = selected[0]
    if (isPreset(next)) setValue(PRESETS[next])
  }
  const handleRoleChange = (role: EAgentRole, setting: RoleSetting) =>
    setValue({ ...draft.value, [role]: setting })

  return (
    <SettingsPage
      title="Models & Effort"
      description="Choose which model each part of the agent runs on and how hard it thinks."
    >
      <SettingsSection
        title="Presets"
        description="Set every role at once. Editing a role switches this to Custom."
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
            <ToggleGroupItem key={preset} value={preset} className="px-4">
              {PRESET_LABELS[preset]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsSection>
      {ROLE_ORDER.map((role) => (
        <RoleCard
          key={role}
          role={role}
          setting={draft.value[role]}
          onChange={(setting) => handleRoleChange(role, setting)}
        />
      ))}
      <ConfigFooter dirty={draft.dirty} onDiscard={draft.discard} onSave={draft.save} />
    </SettingsPage>
  )
}
