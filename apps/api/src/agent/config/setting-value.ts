import {
  encodeSettingValue,
  isProjectSettingKey,
  PROJECT_SETTING_REGISTRY,
  validateProjectSetting,
  type SettingScalar,
} from '@dltech/atlas-core'

export type SettingEncoding = { ok: true; stored: string } | { ok: false; reason: string }

const numberOf = (raw: string): number | undefined => {
  const asNumber = Number(raw)
  return raw.trim() !== '' && Number.isFinite(asNumber) ? asNumber : undefined
}

const candidatesOf = (raw: string): SettingScalar[] => {
  const candidates: SettingScalar[] = []
  if (raw === 'true' || raw === 'false') candidates.push(raw === 'true')
  const asNumber = numberOf(raw)
  if (asNumber !== undefined) candidates.push(asNumber)
  candidates.push(raw)
  return candidates
}

const scalarFor = (args: { type: string; raw: string }): SettingScalar | undefined => {
  if (args.type === 'boolean') {
    return args.raw === 'true' || args.raw === 'false' ? args.raw === 'true' : undefined
  }
  if (args.type === 'number') return numberOf(args.raw)
  return args.raw
}

export const encodeProjectSetting = (args: { key: string; raw: string }): SettingEncoding => {
  const entry = PROJECT_SETTING_REGISTRY.get(args.key)
  if (entry === undefined && !isProjectSettingKey(args.key)) {
    return {
      ok: false,
      reason: `unknown setting key: ${args.key}. setting covers Atlas setting keys only; environment variables are secrets`,
    }
  }
  if (entry === undefined) {
    for (const candidate of candidatesOf(args.raw)) {
      const stored = encodeSettingValue(candidate)
      if (validateProjectSetting({ key: args.key, stored }).ok) return { ok: true, stored }
    }
    return { ok: false, reason: `invalid value for ${args.key}` }
  }
  const type = typeof entry.fallback
  const scalar = scalarFor({ type, raw: args.raw })
  if (scalar === undefined) return { ok: false, reason: `${args.key} expects a ${type} value` }
  const stored = encodeSettingValue(scalar)
  const check = validateProjectSetting({ key: args.key, stored })
  return check.ok ? { ok: true, stored } : check
}
