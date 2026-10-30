'use client'

import { useRouter } from 'next/navigation'

import { ModelSelector } from '@dltech/atlas-ui/ai/model-selector'

import type { ModelPicker } from '@/features/threads/data/use-model-picker'

import type { EEffortLevel } from '@dltech/atlas-wire/web'

import { roleModelOptions } from '../data/personal/role-model-options'
import {
  EFFORT_STEPS,
  ROLE_META,
  type EAgentRole,
  type RoleSetting,
} from '../fixtures/settings-agent'
import { SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'
import { PROVIDERS_HREF } from '../settings-nav'
import { EffortSlider } from './agent-effort-slider'

export function RoleCard({
  role,
  setting,
  picker,
  onChange,
}: {
  role: EAgentRole
  setting: RoleSetting
  picker: ModelPicker
  onChange: (next: RoleSetting) => void
}) {
  const router = useRouter()
  const meta = ROLE_META[role]
  const models = roleModelOptions({
    offered: picker.options.models,
    autoLabel: meta.autoLabel,
    currentId: setting.model,
  })
  const effort = setting.effort
  const effortLabel = EFFORT_STEPS.find((step) => step.effort === effort)?.label

  const handleModelChange = (model: string) => onChange({ ...setting, model })
  const handleEffortChange = (next: EEffortLevel) => onChange({ ...setting, effort: next })
  const handleManageProviders = () => router.push(PROVIDERS_HREF)

  return (
    <SettingsSection title={meta.title} description={meta.description}>
      <SettingsCard>
        <SettingsRow
          title="Model"
          description={meta.modelHint}
          control={
            <ModelSelector
              models={models}
              value={setting.model}
              placeholder={meta.autoLabel}
              onValueChange={handleModelChange}
              pinned={picker.pinned}
              onPinnedChange={picker.onPinnedChange}
              reconnectProviders={picker.options.reconnectProviders}
              onReconnect={handleManageProviders}
              onManageProviders={handleManageProviders}
              className="max-w-64"
            />
          }
        />
        {effort === undefined ? null : (
          <SettingsRow
            title="Effort"
            description="Higher effort thinks longer and costs more per turn."
            control={<span className="font-mono text-xs text-muted-foreground">{effortLabel}</span>}
          >
            <EffortSlider
              value={effort}
              onChange={handleEffortChange}
              label={`${meta.title} effort`}
            />
          </SettingsRow>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
