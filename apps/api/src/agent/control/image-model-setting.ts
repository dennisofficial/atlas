import { EImageModelWire, ESettingId } from '@dltech/atlas-core'

const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'

const IMAGE_MODELS: readonly string[] = Object.values(EImageModelWire)

const decodedSetting = (stored: string): string => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    const parsed: unknown = JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
    return typeof parsed === 'string' ? parsed : stored
  } catch {
    return stored
  }
}

export const imageModelOf = (settings: ReadonlyMap<string, string>): string | undefined => {
  const stored = settings.get(ESettingId.ImageModel)
  if (stored === undefined) return undefined
  const model = decodedSetting(stored)
  return IMAGE_MODELS.includes(model) ? model : undefined
}
