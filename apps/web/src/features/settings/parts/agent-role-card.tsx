'use client'

import { useRouter } from 'next/navigation'

import { ModelSelector } from '@dltech/atlas-ui/ai/model-selector'
import { Switch } from '@dltech/atlas-ui/components/switch'

import type { ModelPicker } from '@/features/threads/data/use-model-picker'

import type { EEffortLevel } from '@dltech/atlas-wire/web'

import { roleModelOptions } from '../data/personal/role-model-options'
import {
  AUTO_MODEL,
  EFFORT_STEPS,
  type RoleMeta,
  type RoleSetting,
} from '../fixtures/settings-agent'
import { SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'
import { PROVIDERS_HREF } from '../settings-nav'
import { EffortSlider } from './agent-effort-slider'

const effortLevelsOf = (efforts: readonly string[] | undefined): EEffortLevel[] | undefined => {
  if (efforts === undefined || efforts.length === 0) return undefined
  const offered = new Set<string>(efforts)
  return EFFORT_STEPS.filter((step) => offered.has(step.effort)).map((step) => step.effort)
}

const ladderIndexOf = (effort: EEffortLevel): number =>
  EFFORT_STEPS.findIndex((step) => step.effort === effort)

const clampedEffort = ({
  supported,
  effort,
}: {
  supported: readonly EEffortLevel[]
  effort: EEffortLevel
}): EEffortLevel | undefined => {
  if (supported.includes(effort)) return effort
  const asked = ladderIndexOf(effort)
  const above = supported.find((level) => ladderIndexOf(level) > asked)
  return above ?? supported[supported.length - 1]
}

export function RoleCard({
  meta,
  setting,
  picker,
  onChange,
  fast,
}: {
  meta: RoleMeta
  setting: RoleSetting
  picker: ModelPicker
  onChange: (next: RoleSetting) => void
  fast?: boolean
}) {
  const router = useRouter()
  const models = roleModelOptions({
    offered: picker.options.models,
    autoLabel: meta.autoLabel,
    currentId: setting.model,
  })
  const effort = setting.effort
  const effortLabel = EFFORT_STEPS.find((step) => step.effort === effort)?.label
  const selected = picker.options.models.find((model) => model.id === setting.model)
  const supportedEfforts = effortLevelsOf(selected?.efforts)
  const modelHasNoEffortMap =
    setting.model !== AUTO_MODEL && selected !== undefined && supportedEfforts === undefined
  const showEffort = effort !== undefined && !modelHasNoEffortMap

  const handleFastChange = (next: boolean) => onChange({ ...setting, fast: next })
  const handleModelChange = (model: string) => {
    const nextSupported =
      effort === undefined
        ? undefined
        : effortLevelsOf(picker.options.models.find((option) => option.id === model)?.efforts)
    const clamped =
      effort === undefined || nextSupported === undefined
        ? undefined
        : clampedEffort({ supported: nextSupported, effort })
    onChange(clamped === undefined ? { ...setting, model } : { ...setting, model, effort: clamped })
  }
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
        {!showEffort || effort === undefined ? null : (
          <SettingsRow
            title="Effort"
            description="Higher effort thinks longer and costs more per turn."
            control={<span className="font-mono text-xs text-muted-foreground">{effortLabel}</span>}
          >
            <EffortSlider
              value={effort}
              onChange={handleEffortChange}
              label={`${meta.title} effort`}
              {...(supportedEfforts === undefined ? {} : { supportedEfforts })}
            />
          </SettingsRow>
        )}
        {fast === undefined ? null : (
          <SettingsRow
            title="Fast mode"
            description="Start conversations in fast mode on models that offer it. Faster output at a higher price: Claude bills usage credits at 2× API rates; ChatGPT plans spend included usage 2.5× as fast."
            control={
              <Switch checked={fast} onCheckedChange={handleFastChange} aria-label="Fast mode" />
            }
          />
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
