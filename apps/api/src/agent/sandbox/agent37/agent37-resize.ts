import { AGENT37_POD_SHAPES } from '@dltech/atlas-core'

export type Agent37Shape = { cpu: number; memory: number }

export const AGENT37_VM_SHAPES: readonly Agent37Shape[] = AGENT37_POD_SHAPES.map((shape) => ({
  cpu: shape.vcpus,
  memory: shape.memoryGb,
}))

export const agent37ShapeOfVcpus = (vcpus: number): Agent37Shape => {
  const fitting = AGENT37_VM_SHAPES.filter((shape) => shape.cpu >= vcpus)
  const chosen = fitting[0] ?? AGENT37_VM_SHAPES[AGENT37_VM_SHAPES.length - 1]
  if (chosen === undefined) throw new Error('agent37 has no vm shape to resize to')
  return chosen
}
