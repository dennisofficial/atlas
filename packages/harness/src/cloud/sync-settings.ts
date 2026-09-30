import type { JsonValue, SettingsStorePort } from '@dltech/atlas-core'

import { CloudError, type CloudClient } from './cloud-client'

const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'

export const encodeSettingValue = (raw: JsonValue): string =>
  `${SETTING_VALUE_PREFIX}${JSON.stringify(raw)}`

const isSettingScalar = (raw: unknown): raw is string | number | boolean =>
  typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'

export const decodeSettingValue = (stored: string): JsonValue => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    const parsed: unknown = JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
    return isSettingScalar(parsed) ? parsed : stored
  } catch {
    return stored
  }
}

export async function uploadLocalSettings(args: {
  client: CloudClient
  localSettings: SettingsStorePort | undefined
}): Promise<number> {
  if (args.localSettings === undefined) return 0

  const values = args.localSettings.read().document.values
  let uploaded = 0
  for (const [key, raw] of Object.entries(values)) {
    if (raw === undefined) continue
    await args.client.setSetting({ key, value: encodeSettingValue(raw) })
    uploaded += 1
  }
  return uploaded
}

export async function downloadRemoteSettings(args: {
  client: CloudClient
  localSettings: SettingsStorePort | undefined
  purge: boolean
}): Promise<number> {
  const remote = await args.client.listSettings()
  if (remote.length === 0) return 0
  if (args.localSettings === undefined) {
    throw new CloudError({
      status: 0,
      message: 'this Atlas has no local settings store to land the cloud settings in',
    })
  }

  const document = args.localSettings.read().document
  const merged: Record<string, JsonValue> = { ...document.values }
  for (const setting of remote) {
    merged[setting.key] = decodeSettingValue(setting.value)
  }

  args.localSettings.write({ values: merged })

  if (args.purge) {
    for (const setting of remote) {
      await args.client.deleteSetting({ key: setting.key })
    }
  }
  return remote.length
}
