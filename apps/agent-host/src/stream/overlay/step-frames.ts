import type { LiveFrame, StreamStepKey } from '@dltech/atlas-protocol'

const MAX_CLOSED_STEPS = 64

export type StepFrame = Extract<LiveFrame, { type: 'step-start' | 'delta' | 'step-end' }>

export const isStepFrame = (frame: LiveFrame): frame is StepFrame =>
  frame.type === 'step-start' || frame.type === 'delta' || frame.type === 'step-end'

export const sameStep = (args: { left: StreamStepKey; right: StreamStepKey }): boolean =>
  args.left.runId === args.right.runId &&
  args.left.step === args.right.step &&
  args.left.attempt === args.right.attempt

const idOf = (key: StreamStepKey): string => JSON.stringify([key.runId, key.step, key.attempt])

export class ClosedSteps {
  private readonly ids = new Set<string>()

  has(key: StreamStepKey): boolean {
    return this.ids.has(idOf(key))
  }

  add(key: StreamStepKey): void {
    const id = idOf(key)
    this.ids.delete(id)
    this.ids.add(id)
    if (this.ids.size <= MAX_CLOSED_STEPS) return
    const oldest = this.ids.values().next().value
    if (oldest !== undefined) this.ids.delete(oldest)
  }
}
