export type SandboxSize = {
  id: string
  vcpus: number | null
  memoryGb: number | null
  estimatedPricePerHour: string | null
}

export const DEFAULT_SIZE_ID = 'default'
export const MEMORY_GB_PER_VCPU = 2
const SIZE_VCPUS = [2, 4, 6, 8] as const

export const SANDBOX_SIZE_OPTIONS: readonly SandboxSize[] = [
  { id: DEFAULT_SIZE_ID, vcpus: null, memoryGb: null, estimatedPricePerHour: null },
  ...SIZE_VCPUS.map((vcpus) => ({
    id: `${vcpus}-vcpu`,
    vcpus,
    memoryGb: vcpus * MEMORY_GB_PER_VCPU,
    estimatedPricePerHour: null,
  })),
]

export const sizeIdOf = (vcpus: number | null): string =>
  vcpus === null ? DEFAULT_SIZE_ID : `${vcpus}-vcpu`

export const vcpusOfSizeId = (id: string): number | null =>
  SANDBOX_SIZE_OPTIONS.find((size) => size.id === id)?.vcpus ?? null
