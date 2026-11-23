import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingKind,
  singleResponsibilityPolicy,
} from '@dltech/atlas-core'
import { readOf } from '@dltech/atlas-models'

export type QualityConfig = {
  enabled: boolean
  policies: Readonly<Record<string, boolean>>
}

const toggleFallbackOf = (id: ESettingId): boolean => {
  const held = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (held === undefined || held.kind !== ESettingKind.Toggle) {
    throw new Error(`the registry no longer holds ${id} as a toggle to read its fallback`)
  }
  return held.fallback
}

export function qualityConfigOf(args: { settings: ReadonlyMap<string, string> }): QualityConfig {
  const read = readOf(args.settings)
  const policies: Record<string, boolean> = {}
  for (const policy of [singleResponsibilityPolicy]) {
    const stored = read(policy.settingKey)
    if (typeof stored === 'boolean') policies[policy.settingKey] = stored
  }
  const stored = read(ESettingId.QualityEnabled)
  return {
    enabled: typeof stored === 'boolean' ? stored : toggleFallbackOf(ESettingId.QualityEnabled),
    policies,
  }
}
