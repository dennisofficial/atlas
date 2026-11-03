import { SANDBOX_VCPU_SIZES } from '@dltech/atlas-wire/web'

export type SandboxSize = {
  id: string
  vcpus: number | null
}

export const DEFAULT_SIZE_ID = 'default'

export const SANDBOX_SIZE_OPTIONS: readonly SandboxSize[] = [
  { id: DEFAULT_SIZE_ID, vcpus: null },
  ...SANDBOX_VCPU_SIZES.map((vcpus) => ({ id: `${vcpus}-vcpu`, vcpus })),
]

export const sizeIdOf = (vcpus: number | null): string =>
  vcpus === null ? DEFAULT_SIZE_ID : `${vcpus}-vcpu`

export const vcpusOfSizeId = (id: string): number | null =>
  SANDBOX_SIZE_OPTIONS.find((size) => size.id === id)?.vcpus ?? null
