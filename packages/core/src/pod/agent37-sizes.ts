import { AGENT37_POD_SHAPES, type PodShape } from './pod-shapes'

export const AGENT37_SIZE_VCPUS: readonly number[] = [2, 4, 8]

export const agent37ShapeOfVcpus = (vcpus: number): PodShape => {
  const fitting = AGENT37_POD_SHAPES.filter((shape) => shape.vcpus >= vcpus)
  const chosen = fitting[0] ?? AGENT37_POD_SHAPES[AGENT37_POD_SHAPES.length - 1]
  if (chosen === undefined) throw new Error('agent37 has no pod shape to boot')
  return chosen
}

export type Agent37SizeOption = { value: string; label: string; detail: string }

export const agent37SizeOptionOf = (shape: PodShape): Agent37SizeOption => ({
  value: String(shape.vcpus),
  label: `${shape.vcpus} vCPU`,
  detail: `${shape.memoryGb} GB RAM`,
})

export const AGENT37_SIZE_OPTIONS: readonly Agent37SizeOption[] = AGENT37_SIZE_VCPUS.map((vcpus) =>
  agent37SizeOptionOf(agent37ShapeOfVcpus(vcpus)),
)
