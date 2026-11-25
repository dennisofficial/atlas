import { AGENT37_POD_SHAPES, type PodShape } from './pod-shapes'

export const agent37ShapeOfVcpus = (vcpus: number): PodShape => {
  const fitting = AGENT37_POD_SHAPES.filter((shape) => shape.vcpus >= vcpus)
  const chosen = fitting[0] ?? AGENT37_POD_SHAPES[AGENT37_POD_SHAPES.length - 1]
  if (chosen === undefined) throw new Error('agent37 has no pod shape to boot')
  return chosen
}

export const podShapeOfSetting = (args: {
  vcpus: number
  memoryGb?: number | undefined
}): PodShape => {
  const exact = AGENT37_POD_SHAPES.find(
    (shape) => shape.vcpus === args.vcpus && shape.memoryGb === args.memoryGb,
  )
  return exact ?? agent37ShapeOfVcpus(args.vcpus)
}

export type Agent37SizeOption = { value: string; label: string; detail: string }

const podShapeKeyOf = (shape: PodShape): string => `${shape.vcpus}x${shape.memoryGb}`

export const agent37SizeOptionOf = (shape: PodShape): Agent37SizeOption => ({
  value: podShapeKeyOf(shape),
  label: `${shape.vcpus} vCPU`,
  detail: `${shape.memoryGb} GB RAM`,
})

export const AGENT37_SIZE_OPTIONS: readonly Agent37SizeOption[] =
  AGENT37_POD_SHAPES.map(agent37SizeOptionOf)
