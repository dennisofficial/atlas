import { encodeSettingValue, type SettingScalar } from '@dltech/atlas-wire/web'

import type { JsonStore } from '../storage/json-store'

export type SettingsValues = ReadonlyMap<string, SettingScalar>

export type SettingsChanges = Record<string, SettingScalar | null>

export type SettingsStorage = {
  load: () => Promise<SettingsValues>
  save: (values: SettingsValues) => Promise<void>
  clear: () => Promise<void>
}

export const SETTINGS_FILE = 'settings.json'

const RECORD_VERSION = 1

const isScalar = (value: unknown): value is SettingScalar =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const valuesFromRecord = (raw: unknown): SettingsValues => {
  if (!isRecord(raw) || raw.version !== RECORD_VERSION || !isRecord(raw.values)) return new Map()
  return new Map(
    Object.entries(raw.values).filter((entry): entry is [string, SettingScalar] =>
      isScalar(entry[1]),
    ),
  )
}

export const recordFromValues = (values: SettingsValues): unknown => ({
  version: RECORD_VERSION,
  values: Object.fromEntries(values),
})

export const jsonSettingsStorage = (args: {
  store: JsonStore
  name?: string | undefined
}): SettingsStorage => {
  const name = args.name ?? SETTINGS_FILE
  return {
    load: () =>
      args.store
        .read(name)
        .then(valuesFromRecord)
        .catch(() => new Map()),
    save: (values) => args.store.write(name, recordFromValues(values)).catch(() => undefined),
    clear: () => args.store.remove(name).catch(() => undefined),
  }
}

export const applyChanges = (values: SettingsValues, changes: SettingsChanges): SettingsValues => {
  const next = new Map(values)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key)
    else next.set(key, value)
  }
  return next
}

export const encodedChanges = (changes: SettingsChanges): Record<string, string | null> =>
  Object.fromEntries(
    Object.entries(changes).map(([key, value]) => [
      key,
      value === null ? null : encodeSettingValue(value),
    ]),
  )
