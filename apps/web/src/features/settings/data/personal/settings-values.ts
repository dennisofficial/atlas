import { CLOUD_SETTING_REGISTRY, type SettingScalar } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

export function settingValue(args: { values: SettingValues; key: string }): SettingScalar {
  const entry = CLOUD_SETTING_REGISTRY.get(args.key)
  if (entry === undefined) throw new Error(`setting ${args.key} is not in the registry`)
  const parsed = entry.schema.safeParse(args.values.get(args.key))
  return parsed.success ? parsed.data : entry.fallback
}

export function settingString(args: { values: SettingValues; key: string }): string {
  const value = settingValue(args)
  return typeof value === 'string' ? value : String(value)
}

export function settingBool(args: { values: SettingValues; key: string }): boolean {
  return settingValue(args) === true
}

export function diffChanges<TValue extends SettingScalar>(args: {
  saved: Record<string, TValue>
  draft: Record<string, TValue>
}): SettingChanges {
  const changes: SettingChanges = {}
  for (const [key, value] of Object.entries(args.draft)) {
    if (args.saved[key] !== value) changes[key] = value
  }
  return changes
}
