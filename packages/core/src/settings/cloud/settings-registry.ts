import { z } from 'zod'

import type { SettingScalar } from './setting-codec'
import {
  HARNESS_SETTING_ENTRIES,
  HARNESS_SETTING_PREFIXES,
  USER_ONLY_SETTING_ENTRIES,
} from './harness-settings'
import type { CloudSettingEntry, SettingValidation } from './setting-entry'
import { entryFor, validateAgainst } from './setting-entry'
import { WEB_ONLY_SETTING_ENTRIES } from './web-only-settings'

export { ESettingConsumer } from './setting-entry'
export type {
  CloudSettingEntry,
  CloudSettingPrefixEntry,
  SettingValidation,
} from './setting-entry'
export * from './setting-enums'

export const CLOUD_SETTING_REGISTRY: ReadonlyMap<string, CloudSettingEntry> = new Map([
  ...HARNESS_SETTING_ENTRIES,
  ...USER_ONLY_SETTING_ENTRIES,
  ...WEB_ONLY_SETTING_ENTRIES,
])

export const PROJECT_SETTING_REGISTRY: ReadonlyMap<string, CloudSettingEntry> = new Map([
  ...HARNESS_SETTING_ENTRIES,
])

export const isProjectSettingKey = (key: string): boolean =>
  entryFor({
    registry: PROJECT_SETTING_REGISTRY,
    prefixes: HARNESS_SETTING_PREFIXES,
    key,
  }) !== undefined

export const resolveCloudSetting = <TValue extends SettingScalar>(args: {
  values: ReadonlyMap<string, SettingScalar>
  key: string
  schema: z.ZodType<TValue>
}): TValue => {
  const entry = entryFor({
    registry: CLOUD_SETTING_REGISTRY,
    prefixes: HARNESS_SETTING_PREFIXES,
    key: args.key,
  })
  if (entry === undefined) throw new Error(`setting ${args.key} is not in the registry`)
  const stored = args.schema.safeParse(args.values.get(args.key))
  if (stored.success) return stored.data
  return args.schema.parse(entry.fallback)
}

export const validateCloudSetting = (args: { key: string; stored: string }): SettingValidation =>
  validateAgainst({
    registry: CLOUD_SETTING_REGISTRY,
    prefixes: HARNESS_SETTING_PREFIXES,
    ...args,
    unknownKeyIsOk: true,
  })

export const validateProjectSetting = (args: { key: string; stored: string }): SettingValidation =>
  validateAgainst({
    registry: PROJECT_SETTING_REGISTRY,
    prefixes: HARNESS_SETTING_PREFIXES,
    ...args,
    unknownKeyIsOk: false,
  })
