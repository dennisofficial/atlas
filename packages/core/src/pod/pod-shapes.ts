import { SANDBOX_MEMORY_GB_PER_VCPU, SANDBOX_VCPU_SIZES } from '../settings/cloud/setting-enums'

export type PodShape = { vcpus: number; memoryGb: number }

export const AGENT37_SANDBOX_PROVIDER = 'agent37'

// https://www.agent37.com/docs/agents-api/instances/resize — resize never adjusts a shape for you,
// and the vm type is chosen by the memory as much as the cpu.
export const AGENT37_POD_SHAPES: readonly PodShape[] = [
  { vcpus: 2, memoryGb: 4 },
  { vcpus: 4, memoryGb: 8 },
  { vcpus: 4, memoryGb: 16 },
  { vcpus: 4, memoryGb: 32 },
  { vcpus: 8, memoryGb: 64 },
]

export const VERCEL_POD_SHAPES: readonly PodShape[] = SANDBOX_VCPU_SIZES.map((vcpus) => ({
  vcpus,
  memoryGb: vcpus * SANDBOX_MEMORY_GB_PER_VCPU,
}))

/** Vercel on Atlas credentials and Agent37 both stop at 8 vCPU. */
export const PLATFORM_POD_VCPU_CAP = 8

export const POD_SHAPE_ENTERPRISE_REASON = 'Needs Enterprise plan'

export type PodShapeUnavailability = { shape: PodShape; reason: string }

export type PodSizing = {
  cap: number
  offered: PodShape[]
  unavailable: PodShapeUnavailability[]
}

export const podShapeEquals = (args: { left: PodShape; right: PodShape }): boolean =>
  args.left.vcpus === args.right.vcpus && args.left.memoryGb === args.right.memoryGb

export const podShapeLabel = (shape: PodShape): string =>
  `${shape.vcpus} vCPU · ${shape.memoryGb} GB`

const offerOf = (args: {
  cap: number
  shapes: readonly PodShape[]
  reason: string
}): PodSizing => ({
  cap: args.cap,
  offered: args.shapes.filter((shape) => shape.vcpus <= args.cap),
  unavailable: args.shapes
    .filter((shape) => shape.vcpus > args.cap)
    .map((shape) => ({ shape, reason: args.reason })),
})

const sizingOfProvider = (sandboxProvider: string): PodSizing =>
  sandboxProvider === AGENT37_SANDBOX_PROVIDER
    ? {
        cap: PLATFORM_POD_VCPU_CAP,
        offered: [...AGENT37_POD_SHAPES],
        unavailable: [],
      }
    : offerOf({
        cap: PLATFORM_POD_VCPU_CAP,
        shapes: VERCEL_POD_SHAPES,
        reason: POD_SHAPE_ENTERPRISE_REASON,
      })

export const podSizingOf = (args: { sandboxProvider: string }): PodSizing =>
  sizingOfProvider(args.sandboxProvider)

export const podShapeAllowed = (args: { shape: PodShape; sizing: PodSizing }): boolean =>
  args.sizing.offered.some((offered) => podShapeEquals({ left: offered, right: args.shape }))

export const podShapeOfferedAt = (args: {
  vcpus: number
  sizing: PodSizing
}): readonly PodShape[] => args.sizing.offered.filter((shape) => shape.vcpus === args.vcpus)

export const podShapeOfVcpus = (args: { vcpus: number; sizing: PodSizing }): PodShape | undefined =>
  podShapeOfferedAt(args)[0]

export const podShapeWhyUnavailable = (args: {
  shape: PodShape
  sizing: PodSizing
}): string | undefined =>
  args.sizing.unavailable.find((entry) => podShapeEquals({ left: entry.shape, right: args.shape }))
    ?.reason
