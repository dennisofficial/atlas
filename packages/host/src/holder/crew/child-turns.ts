import { EAgentRestart, type ThreadId } from '@dltech/atlas-core'
import {
  ETurnStatus,
  type LoopTurnRunner,
  type PauseSignal,
  type TurnOutcome,
} from '@dltech/atlas-agent'

export type DriveArgs = { text: string; restart: boolean } | { resume: true }

type Queued = { readonly pending: number }

type TurnArgs = {
  runner: LoopTurnRunner
  intake: Queued
  pause: PauseSignal
  threadId: ThreadId
  signal: AbortSignal
}

const turn = (args: TurnArgs, text: string | undefined): Promise<TurnOutcome> => {
  const request = { threadId: args.threadId, signal: args.signal, pause: args.pause }
  return text === undefined ? args.runner.runTurn(request) : args.runner.say({ ...request, text })
}

const firstTurn = async (
  args: TurnArgs & { drive: DriveArgs; restarted(via: EAgentRestart): Promise<void> },
): Promise<TurnOutcome> => {
  if ('resume' in args.drive) {
    await args.restarted(EAgentRestart.Relocation)
    return args.runner.resume({
      threadId: args.threadId,
      signal: args.signal,
      pause: args.pause,
    })
  }
  if (args.drive.restart) await args.restarted(EAgentRestart.Message)
  return turn(args, args.drive.text)
}

export const driveTurns = async (
  args: TurnArgs & {
    drive: DriveArgs
    stopped(): boolean
    restarted(via: EAgentRestart): Promise<void>
  },
): Promise<TurnOutcome> => {
  let outcome = await firstTurn(args)
  while (outcome.status === ETurnStatus.Completed && !args.stopped() && args.intake.pending > 0) {
    outcome = await turn(args, undefined)
  }
  return outcome
}
