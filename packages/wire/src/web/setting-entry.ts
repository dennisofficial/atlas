import type { z } from 'zod'

import type { SettingScalar } from './setting-codec'
import { decodeSettingValue } from './setting-codec'

export enum ESettingConsumer {
  Harness = 'harness',
  Api = 'api',
  None = 'none',
}

export type CloudSettingEntry = {
  key: string
  schema: z.ZodType<SettingScalar>
  fallback: SettingScalar
  consumer: ESettingConsumer
}

export type SettingValidation = { ok: true } | { ok: false; reason: string }

export const settingEntry = (entry: CloudSettingEntry): [string, CloudSettingEntry] => [
  entry.key,
  entry,
]

export const validateAgainst = (args: {
  registry: ReadonlyMap<string, CloudSettingEntry>
  key: string
  stored: string
  unknownKeyIsOk: boolean
}): SettingValidation => {
  const entry = args.registry.get(args.key)
  if (entry === undefined) {
    return args.unknownKeyIsOk
      ? { ok: true }
      : { ok: false, reason: `unknown setting key: ${args.key}` }
  }
  const parsed = entry.schema.safeParse(decodeSettingValue(args.stored))
  if (parsed.success) return { ok: true }
  return { ok: false, reason: `invalid value for ${args.key}: ${parsed.error.issues[0]?.message ?? 'rejected'}` }
}
