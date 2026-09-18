import { toStepId, type ChannelSignal, type StepId } from '../channel/signal'
import { EServeFrame, type ServeFrame } from '../cloud/channel-wire'

/**
 * A client told to reload ends the step it was streaming, so replaying that step under its original
 * id would accumulate onto the record it just closed and render the answer twice. The in-process
 * channel never restarts a step id either — it mints one per step — so the replay, and every later
 * frame of that step sent to that one client, carries a fresh id.
 */
export type StepAlias = { from: StepId; to: StepId }

export type StepAliaser = { next: (stepId: StepId) => StepAlias }

export function createStepAliaser(): StepAliaser {
  let replays = 0

  return {
    next: (stepId) => {
      replays += 1
      return { from: stepId, to: toStepId(`${stepId}~replay-${replays}`) }
    },
  }
}

export const stepIdOf = (frame: ServeFrame): StepId | undefined => {
  if (frame.kind !== EServeFrame.Signal) return undefined
  const { signal } = frame
  if (signal.type === 'step-started') return signal.stepId
  if (signal.type === 'chunk') return signal.stepId
  if (signal.type === 'step-ended') return signal.stepId
  return undefined
}

const renamed = (signal: ChannelSignal, stepId: StepId): ChannelSignal => {
  if (signal.type === 'step-started') return { ...signal, stepId }
  if (signal.type === 'chunk') return { ...signal, stepId }
  if (signal.type === 'step-ended') return { ...signal, stepId }
  return signal
}

export function retagged(args: { frame: ServeFrame; alias: StepAlias }): ServeFrame {
  if (args.frame.kind !== EServeFrame.Signal) return args.frame
  if (stepIdOf(args.frame) !== args.alias.from) return args.frame
  return { ...args.frame, signal: renamed(args.frame.signal, args.alias.to) }
}

export function endsAliasedStep(args: { frame: ServeFrame; alias: StepAlias }): boolean {
  if (args.frame.kind !== EServeFrame.Signal) return false
  return args.frame.signal.type === 'step-ended' && stepIdOf(args.frame) === args.alias.from
}
