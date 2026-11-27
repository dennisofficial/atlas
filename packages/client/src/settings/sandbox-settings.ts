import {
  AGENT37_SIZE_OPTIONS,
  DEFAULT_SANDBOX_DISK_GB,
  DEFAULT_SANDBOX_VCPUS,
  decodeSettingValue,
  EConfigLayer,
  encodeSettingValue,
  podShapeOfSetting,
  SANDBOX_DISK_GB_SIZES,
  type Agent37SizeOption,
  type LayeredSettingLayer,
  type SettingScalar,
} from '@dltech/atlas-wire/web'

export const INHERIT_VALUE = 'default'

export const SANDBOX_SETTING_KEYS = ['sandbox.vcpus', 'sandbox.memoryGb', 'sandbox.diskGb']

export const SANDBOX_SIZE_TITLE = 'Sandbox size'
export const SANDBOX_SIZE_DESCRIPTION =
  'The machine a new cloud sandbox boots on. Applies when a sandbox is created; resize a running one from its session.'
export const SANDBOX_DISK_TITLE = 'Sandbox disk'
export const SANDBOX_DISK_DESCRIPTION =
  'Disk size for new pods. Pods grow automatically when they fill up. Agent37 pods only.'

export type ISandboxSize = { vcpus: number; memoryGb: number | null }

export type IInheritedSandbox = { size: ISandboxSize; diskGb: number }

export const DEFAULT_SANDBOX_SIZE: ISandboxSize = { vcpus: DEFAULT_SANDBOX_VCPUS, memoryGb: null }

const shapeOf = (size: ISandboxSize) =>
  podShapeOfSetting({ vcpus: size.vcpus, memoryGb: size.memoryGb ?? undefined })

export const sizeKeyOf = (size: ISandboxSize): string => {
  const shape = shapeOf(size)
  return `${shape.vcpus}x${shape.memoryGb}`
}

const sizeOfKey = (key: string): ISandboxSize => {
  const [rawVcpus, rawMemoryGb] = key.split('x')
  const vcpus = Number(rawVcpus)
  const memoryGb = Number(rawMemoryGb)
  if (
    rawVcpus === undefined ||
    rawMemoryGb === undefined ||
    !Number.isInteger(vcpus) ||
    !Number.isInteger(memoryGb)
  ) {
    throw new Error(`unknown sandbox size ${key}`)
  }
  return { vcpus, memoryGb }
}

const inheritSizeOptionOf = (inherited: ISandboxSize): Agent37SizeOption => {
  const shape = shapeOf(inherited)
  return {
    value: INHERIT_VALUE,
    label: 'Default',
    detail: `${shape.vcpus} vCPU · ${shape.memoryGb} GB RAM`,
  }
}

export const sandboxSizeOptionsOf = ({
  inherited,
  withAccountDefault,
  options = AGENT37_SIZE_OPTIONS,
}: {
  inherited: ISandboxSize
  withAccountDefault: boolean
  options?: readonly Agent37SizeOption[]
}): readonly Agent37SizeOption[] =>
  withAccountDefault ? [inheritSizeOptionOf(inherited), ...options] : [...options]

export const savedSizeValueOf = ({
  value,
  withAccountDefault,
}: {
  value: ISandboxSize | null
  withAccountDefault: boolean
}): string => {
  if (value === null) {
    return withAccountDefault ? INHERIT_VALUE : sizeKeyOf(DEFAULT_SANDBOX_SIZE)
  }
  return sizeKeyOf(value)
}

export const sizeValueToSave = ({
  selected,
  withAccountDefault,
}: {
  selected: string
  withAccountDefault: boolean
}): ISandboxSize | null =>
  withAccountDefault && selected === INHERIT_VALUE ? null : sizeOfKey(selected)

export const defaultDiskGbOf = (inheritedDiskGb: number | undefined): number =>
  inheritedDiskGb ?? DEFAULT_SANDBOX_DISK_GB

export const SANDBOX_DISK_OPTIONS: readonly Agent37SizeOption[] = SANDBOX_DISK_GB_SIZES.map(
  (diskGb) => ({ value: String(diskGb), label: `${diskGb} GB`, detail: `${diskGb} GB` }),
)

const inheritDiskOptionOf = (diskGb: number): Agent37SizeOption => ({
  value: INHERIT_VALUE,
  label: 'Default',
  detail: `${diskGb} GB`,
})

export const sandboxDiskOptionsOf = ({
  inheritedDiskGb,
  withAccountDefault,
}: {
  inheritedDiskGb: number
  withAccountDefault: boolean
}): readonly Agent37SizeOption[] =>
  withAccountDefault
    ? [inheritDiskOptionOf(inheritedDiskGb), ...SANDBOX_DISK_OPTIONS]
    : SANDBOX_DISK_OPTIONS

export const savedDiskValueOf = ({
  diskGb,
  withAccountDefault,
}: {
  diskGb: number | null
  withAccountDefault: boolean
}): string => {
  if (diskGb === null) {
    return withAccountDefault ? INHERIT_VALUE : String(DEFAULT_SANDBOX_DISK_GB)
  }
  return String(diskGb)
}

export const diskValueToSave = ({
  selected,
  withAccountDefault,
}: {
  selected: string
  withAccountDefault: boolean
}): number | null => (withAccountDefault && selected === INHERIT_VALUE ? null : Number(selected))

export const diskSettingValuesOf = (diskGb: number | null): Record<string, string | null> => ({
  'sandbox.diskGb': diskGb === null ? null : encodeSettingValue(diskGb),
})

const numberAt = (values: ReadonlyMap<string, unknown>, key: string): number | null => {
  const value = values.get(key)
  return typeof value === 'number' ? value : null
}

export const inheritedSandboxOf = ({
  layers,
  own,
}: {
  layers: readonly LayeredSettingLayer[]
  own: EConfigLayer
}): IInheritedSandbox => {
  const ownIndex = layers.findIndex((entry) => entry.layer === own)
  const below = ownIndex === -1 ? layers : layers.slice(0, ownIndex)
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

export const ownValuesOf = ({
  layers,
  own,
}: {
  layers: readonly LayeredSettingLayer[]
  own: EConfigLayer
}): ReadonlyMap<string, SettingScalar> => {
  const layer = layers.find((entry) => entry.layer === own)
  return new Map((layer?.values ?? []).map((value) => [value.key, decodeSettingValue(value.value)]))
}

export const sandboxOfValues = (
  values: ReadonlyMap<string, SettingScalar>,
): { size: ISandboxSize | null; diskGb: number | null } => {
  const vcpus = numberAt(values, 'sandbox.vcpus')
  const diskGb = numberAt(values, 'sandbox.diskGb')
  return {
    size: vcpus === null ? null : { vcpus, memoryGb: numberAt(values, 'sandbox.memoryGb') },
    diskGb,
  }
}

export const sizeSettingValuesOf = (size: ISandboxSize | null): Record<string, string | null> =>
  size === null
    ? { 'sandbox.vcpus': null, 'sandbox.memoryGb': null }
    : {
        'sandbox.vcpus': encodeSettingValue(size.vcpus),
        'sandbox.memoryGb': size.memoryGb === null ? null : encodeSettingValue(size.memoryGb),
      }
