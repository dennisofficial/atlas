import { HARNESS_SETTING_ENTRIES } from './harness-settings'
import type { CloudSettingEntry, SettingValidation } from './setting-entry'
import { validateAgainst } from './setting-entry'
import { WEB_ONLY_SETTING_ENTRIES } from './web-only-settings'

export { ESettingConsumer } from './setting-entry'
export type { CloudSettingEntry, SettingValidation } from './setting-entry'
export * from './setting-enums'

export const CLOUD_SETTING_REGISTRY: ReadonlyMap<string, CloudSettingEntry> = new Map([
  ...HARNESS_SETTING_ENTRIES,
  ...WEB_ONLY_SETTING_ENTRIES,
])

export const PROJECT_SETTING_REGISTRY: ReadonlyMap<string, CloudSettingEntry> = new Map([
  ...HARNESS_SETTING_ENTRIES,
])

export const validateCloudSetting = (args: { key: string; stored: string }): SettingValidation =>
  validateAgainst({ registry: CLOUD_SETTING_REGISTRY, ...args, unknownKeyIsOk: true })

export const validateProjectSetting = (args: { key: string; stored: string }): SettingValidation =>
  validateAgainst({ registry: PROJECT_SETTING_REGISTRY, ...args, unknownKeyIsOk: false })
