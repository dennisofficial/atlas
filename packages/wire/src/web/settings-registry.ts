import { z } from 'zod'

import { HARNESS_SETTING_ENTRIES } from './harness-settings'
import type { CloudSettingEntry, SettingValidation } from './setting-entry'
import { ESettingConsumer, settingEntry, validateAgainst } from './setting-entry'
import { EWorkspaceRegion } from './setting-enums'
import { WEB_ONLY_SETTING_ENTRIES } from './web-only-settings'

export { ESettingConsumer } from './setting-entry'
export type { CloudSettingEntry, SettingValidation } from './setting-entry'
export * from './setting-enums'

export const CLOUD_SETTING_REGISTRY: ReadonlyMap<string, CloudSettingEntry> = new Map([
  ...HARNESS_SETTING_ENTRIES,
  ...WEB_ONLY_SETTING_ENTRIES,
])

export const WORKSPACE_SETTING_REGISTRY: ReadonlyMap<string, CloudSettingEntry> = new Map([
  settingEntry({
    key: 'workspace.defaultRegion',
    schema: z.enum(EWorkspaceRegion),
    fallback: EWorkspaceRegion.Iad1,
    consumer: ESettingConsumer.None,
  }),
  settingEntry({
    key: 'workspace.defaultModel',
    schema: z.string(),
    fallback: '',
    consumer: ESettingConsumer.None,
  }),
])

export const VERCEL_PROJECT_ID_SETTING = 'sandbox.vercelProjectId'

export const PROJECT_SETTING_REGISTRY: ReadonlyMap<string, CloudSettingEntry> = new Map([
  settingEntry({
    key: VERCEL_PROJECT_ID_SETTING,
    schema: z.string().trim().max(500),
    fallback: '',
    consumer: ESettingConsumer.Api,
  }),
  ...HARNESS_SETTING_ENTRIES,
])

export const validateCloudSetting = (args: { key: string; stored: string }): SettingValidation =>
  validateAgainst({ registry: CLOUD_SETTING_REGISTRY, ...args, unknownKeyIsOk: true })

export const validateWorkspaceSetting = (args: {
  key: string
  stored: string
}): SettingValidation =>
  validateAgainst({ registry: WORKSPACE_SETTING_REGISTRY, ...args, unknownKeyIsOk: false })

export const validateProjectSetting = (args: { key: string; stored: string }): SettingValidation =>
  validateAgainst({ registry: PROJECT_SETTING_REGISTRY, ...args, unknownKeyIsOk: false })
