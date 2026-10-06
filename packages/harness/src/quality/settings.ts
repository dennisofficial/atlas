import {
  ESettingId,
  ESettingKind,
  ESettingPage,
  type QualityPolicyDescriptor,
  type ToggleDefinition,
} from '@dltech/atlas-core'

export type QualitySettingsAccessor = () => Readonly<Record<string, unknown>>

export type QualitySwitches = {
  enabled: boolean
  recordExamples: boolean
  policyFlags: Record<string, boolean>
}

const POLICY_GROUP = 'Policies'

export function qualitySwitches({ values }: { values: Readonly<Record<string, unknown>> }): QualitySwitches {
  const policyFlags: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'boolean') policyFlags[key] = value
  }
  return {
    enabled: values[ESettingId.QualityEnabled] === true,
    recordExamples: values[ESettingId.QualityRecordExamples] === true,
    policyFlags,
  }
}

export function qualitySettingDefinitions({
  policies,
}: {
  policies: readonly QualityPolicyDescriptor[]
}): readonly ToggleDefinition[] {
  return policies.map((descriptor) => ({
    id: descriptor.settingKey,
    page: ESettingPage.CodeQuality,
    group: POLICY_GROUP,
    label: descriptor.title,
    description: descriptor.description,
    kind: ESettingKind.Toggle,
    fallback: descriptor.defaultEnabled,
  }))
}
