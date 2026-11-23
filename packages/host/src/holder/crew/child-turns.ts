import { EAgentRestart, type ThreadId } from '@dltech/atlas-core'
import type { HostTimers } from '../ports'
import {
  ETurnStatus,
  type LoopTurnRunner,
  type PauseSignal,
  type TurnOutcome,
} from '@dltech/atlas-agent'

export type DriveArgs = { restart: boolean } | { resume: true }

type TurnArgs = {
  runner: LoopTurnRunner
  pause: PauseSignal
  threadId: ThreadId
  signal: AbortSignal
}

const turn = (args: TurnArgs): Promise<TurnOutcome> =>
  args.runner.runTurn({ threadId: args.threadId, signal: args.signal, pause: args.pause })

const firstTurn = async (
  args: TurnArgs & { drive: DriveArgs; restarted(via: EAgentRestart): Promise<void> },
): Promise<TurnOutcome> => {
  if ('resume' in args.drive) {
    return args.runner.resume({
      threadId: args.threadId,
      signal: args.signal,
      pause: args.pause,
    })
  }
  if (args.drive.restart) await args.restarted(EAgentRestart.Message)
  return turn(args)
}

const resumesAfter = (outcome: TurnOutcome): boolean =>
  outcome.status === ETurnStatus.Completed || outcome.status === ETurnStatus.Idle

export const settledWithin = (args: {
  timers: HostTimers
  ms: number
  done: Promise<void>
}): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const timer = args.timers.setTimeout(() => resolve(false), args.ms)
    void args.done.then(() => {
      args.timers.clearTimeout(timer)
      resolve(true)
    })
  })

export const driveLifecycle = async (
  args: TurnArgs & {
    drive: DriveArgs
    stopped(): boolean
    restarted(via: EAgentRestart): Promise<void>
    owedTurn(): boolean | Promise<boolean>
    handingOff(): boolean
    reset(): void
    settle(outcome: TurnOutcome): Promise<void>
  },
): Promise<void> => {
  let next: DriveArgs = args.drive
  for (;;) {
    args.reset()
    const outcome = await firstTurn({
      runner: args.runner,
      pause: args.pause,
      threadId: args.threadId,
      signal: args.signal,
      drive: next,
      restarted: args.restarted,
    })
    if (args.handingOff()) return
    if (!resumesAfter(outcome) || !(await args.owedTurn())) {
      await args.settle(outcome)
      if (!resumesAfter(outcome) || !(await args.owedTurn())) return
    }
    next = { resume: true }
  }
}
