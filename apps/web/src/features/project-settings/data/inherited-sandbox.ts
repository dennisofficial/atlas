import {
  decodeSettingValue,
  encodeSettingValue,
  EConfigLayer,
  type LayeredSettingLayer,
  type SettingScalar,
} from '@dltech/atlas-wire/web'

import { defaultDiskGbOf } from '@/features/settings/parts/sandbox-disk-section'
import {
  DEFAULT_SANDBOX_SIZE,
  type SandboxSize,
} from '@/features/settings/parts/sandbox-size-section'

export const SANDBOX_SETTING_KEYS = ['sandbox.vcpus', 'sandbox.memoryGb', 'sandbox.diskGb']

export type InheritedSandbox = { size: SandboxSize; diskGb: number }

const numberAt = (values: ReadonlyMap<string, unknown>, key: string): number | null => {
  const value = values.get(key)
  return typeof value === 'number' ? value : null
}

export const inheritedSandboxOf = (args: {
  layers: readonly LayeredSettingLayer[]
  own: EConfigLayer
}): InheritedSandbox => {
  const ownIndex = args.layers.findIndex((entry) => entry.layer === args.own)
  const below = ownIndex === -1 ? args.layers : args.layers.slice(0, ownIndex)
  const values = new Map<string, unknown>()
  for (const layer of below) {
    for (const value of layer.values) values.set(value.key, decodeSettingValue(value.value))
  }
  return {
    size: {
      vcpus: numberAt(values, 'sandbox.vcpus') ?? DEFAULT_SANDBOX_SIZE.vcpus,
      memoryGb: numberAt(values, 'sandbox.memoryGb') ?? DEFAULT_SANDBOX_SIZE.memoryGb,
    },
    diskGb: defaultDiskGbOf(numberAt(values, 'sandbox.diskGb') ?? undefined),
  }
}

export const ownValuesOf = (args: {
  layers: readonly LayeredSettingLayer[]
  own: EConfigLayer
}): ReadonlyMap<string, SettingScalar> => {
  const own = args.layers.find((entry) => entry.layer === args.own)
  return new Map((own?.values ?? []).map((value) => [value.key, decodeSettingValue(value.value)]))
}

export const sandboxOfValues = (
  values: ReadonlyMap<string, SettingScalar>,
): { size: SandboxSize | null; diskGb: number | null } => {
  const vcpus = numberAt(values, 'sandbox.vcpus')
  const diskGb = numberAt(values, 'sandbox.diskGb')
  return {
    size: vcpus === null ? null : { vcpus, memoryGb: numberAt(values, 'sandbox.memoryGb') },
    diskGb,
  }
}

export const sizeSettingValuesOf = (size: SandboxSize | null): Record<string, string | null> =>
  size === null
    ? { 'sandbox.vcpus': null, 'sandbox.memoryGb': null }
    : {
        'sandbox.vcpus': encodeSettingValue(size.vcpus),
        'sandbox.memoryGb': size.memoryGb === null ? null : encodeSettingValue(size.memoryGb),
      }
