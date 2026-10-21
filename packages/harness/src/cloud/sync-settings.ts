import type { JsonValue, SettingsStorePort } from '@dltech/atlas-core'
import { decodeSettingValue, encodeSettingValue } from '@dltech/atlas-wire/web'

import { CloudError, type CloudClient } from './cloud-client'

export { decodeSettingValue, encodeSettingValue }

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
