import {
  ATLAS_SETTINGS,
  CLIENT_SETTING_IDS,
  decodeSettingValue,
  encodeSettingValue,
  ESettingsLayer,
  resolveSettings,
  type SettingDefinition,
  type SettingValue,
  type SettingsResolution,
} from '@dltech/atlas-core'

export type CloudValues = ReadonlyMap<string, string>

export const ACCOUNT_ORIGIN = 'your account'

const CLIENT_SETTING_ID_SET: ReadonlySet<string> = new Set(CLIENT_SETTING_IDS)

const isScalar = (value: unknown): value is SettingValue =>
  typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number'

export const cloudValuesOf = (args: {
  settings: readonly { key: string; value: string }[]
}): CloudValues => new Map(args.settings.map((row) => [row.key, row.value]))

export const decodedValuesOf = (values: CloudValues): ReadonlyMap<string, SettingValue> =>
  new Map([...values].map(([key, stored]) => [key, decodeSettingValue(stored)] as const))

export const resolutionOf = (args: {
  definitions: readonly SettingDefinition[]
  values: ReadonlyMap<string, SettingValue>
}): SettingsResolution =>
  resolveSettings({
    definitions: args.definitions,
    layers: [
      {
        layer: ESettingsLayer.Cloud,
        origin: ACCOUNT_ORIGIN,
        values: Object.fromEntries(args.values),
      },
    ],
  })

export const seedValuesOf = (args: {
  preferences: Record<string, unknown>
}): ReadonlyMap<string, SettingValue> =>
  new Map(
    Object.entries(args.preferences).flatMap(([key, value]) =>
      CLIENT_SETTING_ID_SET.has(key) && isScalar(value) ? [[key, value] as const] : [],
    ),
  )

export const preferencesOf = (
  values: ReadonlyMap<string, SettingValue>,
): Record<string, SettingValue> =>
  Object.fromEntries([...values].filter(([key]) => CLIENT_SETTING_ID_SET.has(key)))

export const writeOf = (args: {
  definition: SettingDefinition
  value: SettingValue
}): { key: string; value: string } | 'remove' =>
  args.value === args.definition.fallback
    ? 'remove'
    : { key: args.definition.id, value: encodeSettingValue(args.value) }

export const definitionOfSetting = (id: string): SettingDefinition | undefined =>
  ATLAS_SETTINGS.find((definition) => definition.id === id)
