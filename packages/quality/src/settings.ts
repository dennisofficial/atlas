import { ESettingId } from '@dltech/atlas-core'

export type QualitySettingsAccessor = () => Readonly<Record<string, unknown>>

export type QualitySwitches = {
  enabled: boolean
  policyFlags: Record<string, boolean>
}

export function qualitySwitches({
  values,
}: {
  values: Readonly<Record<string, unknown>>
}): QualitySwitches {
  const policyFlags: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'boolean') policyFlags[key] = value
  }
  return {
    enabled: values[ESettingId.QualityEnabled] === true,
    policyFlags,
  }
}
