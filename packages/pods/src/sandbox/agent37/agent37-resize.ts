import {
  AGENT37_POD_SHAPES,
  agent37ShapeOfVcpus as agent37PodShapeOfVcpus,
  podShapeOfSetting,
} from '@dltech/atlas-core'

export type Agent37Shape = { cpu: number; memory: number }

export const AGENT37_VM_SHAPES: readonly Agent37Shape[] = AGENT37_POD_SHAPES.map((shape) => ({
  cpu: shape.vcpus,
  memory: shape.memoryGb,
}))

export const agent37ShapeOfVcpus = (vcpus: number): Agent37Shape => {
  const shape = agent37PodShapeOfVcpus(vcpus)
  return { cpu: shape.vcpus, memory: shape.memoryGb }
}

export const agent37ShapeOfSetting = (args: {
  vcpus: number
  memoryGb?: number | undefined
}): Agent37Shape => {
  const shape = podShapeOfSetting(args)
  return { cpu: shape.vcpus, memory: shape.memoryGb }
}

export const grownDiskOf = (args: {
  current: number | undefined
  wanted: number | undefined
}): number | undefined => {
  if (args.wanted === undefined) return undefined
  if (args.current !== undefined && args.current >= args.wanted) return undefined
  return args.wanted
}
