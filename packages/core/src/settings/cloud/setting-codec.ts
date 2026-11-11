export type SettingScalar = string | number | boolean

const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'

export const encodeSettingValue = (raw: unknown): string =>
  `${SETTING_VALUE_PREFIX}${JSON.stringify(raw)}`

const isSettingScalar = (raw: unknown): raw is SettingScalar =>
  typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'

export const decodeSettingValue = (stored: string): SettingScalar => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    const parsed: unknown = JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
    return isSettingScalar(parsed) ? parsed : stored
  } catch {
    return stored
  }
}
