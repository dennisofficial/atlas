import type { SteeringBatch } from './child-runner'
import type { ChildState } from './child-state'

export function steeringOf(child: ChildState): SteeringBatch {
  const held = child.pending
  let captured: readonly ChildState['pending'][number][] | undefined
  return {
    peek: () => {
      captured ??= [...held]
      return captured
    },
    acknowledge: () => {
      const taken = captured ?? []
      if (taken.length > 0) held.splice(0, taken.length)
    },
    release: () => {
      captured = undefined
    },
  }
}
