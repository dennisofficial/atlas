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

export type CloudSettingPrefixEntry = Omit<CloudSettingEntry, 'key'> & {
  prefix: string
}

export const prefixEntry = (entry: CloudSettingPrefixEntry): CloudSettingPrefixEntry => entry

export const entryFor = (args: {
  registry: ReadonlyMap<string, CloudSettingEntry>
  prefixes: readonly CloudSettingPrefixEntry[]
  key: string
}): CloudSettingEntry | undefined => {
  const exact = args.registry.get(args.key)
  if (exact !== undefined) return exact
  const match = args.prefixes.find(
    (entry) => args.key.startsWith(entry.prefix) && args.key.length > entry.prefix.length,
  )
  return match === undefined ? undefined : { ...match, key: args.key }
}

export type SettingValidation = { ok: true } | { ok: false; reason: string }

export const settingEntry = (entry: CloudSettingEntry): [string, CloudSettingEntry] => [
  entry.key,
  entry,
]

export const validateAgainst = (args: {
  registry: ReadonlyMap<string, CloudSettingEntry>
  prefixes: readonly CloudSettingPrefixEntry[]
  key: string
  stored: string
  unknownKeyIsOk: boolean
}): SettingValidation => {
  const entry = entryFor(args)
  if (entry === undefined) {
    return args.unknownKeyIsOk
      ? { ok: true }
      : { ok: false, reason: `unknown setting key: ${args.key}` }
  }
  const parsed = entry.schema.safeParse(decodeSettingValue(args.stored))
  if (parsed.success) return { ok: true }
  return {
    ok: false,
    reason: `invalid value for ${args.key}: ${parsed.error.issues[0]?.message ?? 'rejected'}`,
  }
}
