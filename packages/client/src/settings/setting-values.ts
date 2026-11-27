import { CLOUD_SETTING_REGISTRY, type SettingScalar } from '@dltech/atlas-wire/web'

export type ISettingValues = ReadonlyMap<string, SettingScalar>

export type ISettingChanges = Record<string, SettingScalar | null>

export function settingValue(args: { values: ISettingValues; key: string }): SettingScalar {
  const entry = CLOUD_SETTING_REGISTRY.get(args.key)
  if (entry === undefined) throw new Error(`setting ${args.key} is not in the registry`)
  const parsed = entry.schema.safeParse(args.values.get(args.key))
  return parsed.success ? parsed.data : entry.fallback
}

export function settingString(args: { values: ISettingValues; key: string }): string {
  const value = settingValue(args)
  return typeof value === 'string' ? value : String(value)
}

export function settingBool(args: { values: ISettingValues; key: string }): boolean {
  return settingValue(args) === true
}

export function diffChanges<TValue extends SettingScalar>(args: {
  saved: Record<string, TValue>
  draft: Record<string, TValue>
}): ISettingChanges {
  const changes: ISettingChanges = {}
  for (const [key, value] of Object.entries(args.draft)) {
    if (args.saved[key] !== value) changes[key] = value
  }
  return changes
}
