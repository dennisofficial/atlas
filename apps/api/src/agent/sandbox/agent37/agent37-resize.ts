export type Agent37Shape = { cpu: number; memory: number }

// https://www.agent37.com/docs/agents-api/instances/resize — resize never adjusts a shape for you,
// so every vCPU count maps onto one of the vm shapes the platform accepts.
export const AGENT37_VM_SHAPES: readonly Agent37Shape[] = [
  { cpu: 2, memory: 4 },
  { cpu: 4, memory: 8 },
  { cpu: 4, memory: 16 },
  { cpu: 4, memory: 32 },
  { cpu: 8, memory: 64 },
]

export const agent37ShapeOfVcpus = (vcpus: number): Agent37Shape => {
  const fitting = AGENT37_VM_SHAPES.filter((shape) => shape.cpu >= vcpus)
  const chosen = fitting[0] ?? AGENT37_VM_SHAPES[AGENT37_VM_SHAPES.length - 1]
  if (chosen === undefined) throw new Error('agent37 has no vm shape to resize to')
  return chosen
}
