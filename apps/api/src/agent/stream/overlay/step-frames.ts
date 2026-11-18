import type { LiveFrame, StreamStepKey } from '@dltech/atlas-protocol'

export type OpenStep = { key: StreamStepKey; have: Map<string, number> }

export type StepFrame = Extract<LiveFrame, { type: 'step-start' | 'delta' | 'step-end' }>

export const isStepFrame = (frame: LiveFrame): frame is StepFrame =>
  frame.type === 'step-start' || frame.type === 'delta' || frame.type === 'step-end'

export const sameStep = (args: { left: StreamStepKey; right: StreamStepKey }): boolean =>
  args.left.runId === args.right.runId &&
  args.left.step === args.right.step &&
  args.left.attempt === args.right.attempt

export const sameLengths = (args: {
  left: Map<string, number>
  right: Map<string, number>
}): boolean =>
  args.left.size === args.right.size &&
  [...args.left].every(([block, length]) => args.right.get(block) === length)
