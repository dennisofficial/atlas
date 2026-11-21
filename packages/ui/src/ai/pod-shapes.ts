export interface PodShape {
  vcpus: number
  memoryGb: number
}

export interface UnavailablePodShape {
  shape: PodShape
  reason: string
}

export const AGENT37_POD_SHAPES: readonly PodShape[] = [
  { vcpus: 2, memoryGb: 4 },
  { vcpus: 4, memoryGb: 8 },
  { vcpus: 4, memoryGb: 16 },
  { vcpus: 4, memoryGb: 32 },
  { vcpus: 8, memoryGb: 64 },
]

const VERCEL_GB_PER_VCPU = 2
const VERCEL_MAX_VCPUS = 32

const VERCEL_VCPUS: readonly number[] = [
  1,
  ...Array.from({ length: VERCEL_MAX_VCPUS / 2 }, (_, index) => (index + 1) * 2),
]

export function vercelPodShapesOf({ maxVcpus }: { maxVcpus: number }): PodShape[] {
  return VERCEL_VCPUS.filter((vcpus) => vcpus <= maxVcpus).map((vcpus) => ({
    vcpus,
    memoryGb: vcpus * VERCEL_GB_PER_VCPU,
  }))
}

export function podShapeKey(shape: PodShape): string {
  return `${shape.vcpus}x${shape.memoryGb}`
}

export function podShapeLabel(shape: PodShape): string {
  return `${shape.vcpus} vCPU · ${shape.memoryGb} GB`
}

export function samePodShape({ a, b }: { a: PodShape; b: PodShape }): boolean {
  return a.vcpus === b.vcpus && a.memoryGb === b.memoryGb
}
