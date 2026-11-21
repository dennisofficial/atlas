import {
  AGENT37_POD_SHAPES,
  agent37ShapeOfVcpus as agent37PodShapeOfVcpus,
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
