import { ATLAS_SETTINGS, decodeSettingValue, ESettingId, ESettingKind } from '@dltech/atlas-core'

export type RotationConfig = { autoRotateAtPercent: number }

const rangeFallbackOf = (id: ESettingId): number => {
  const held = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (held === undefined || held.kind !== ESettingKind.Range) {
    throw new Error(`the registry no longer holds ${id} as a range to read its fallback`)
  }
  return held.fallback
}

export function rotationConfigOf(args: { settings: ReadonlyMap<string, string> }): RotationConfig {
  const stored = args.settings.get(ESettingId.AutoRotate)
  const decoded = stored === undefined ? undefined : decodeSettingValue(stored)
  return {
    autoRotateAtPercent:
      typeof decoded === 'number' && Number.isFinite(decoded)
        ? decoded
        : rangeFallbackOf(ESettingId.AutoRotate),
  }
}
