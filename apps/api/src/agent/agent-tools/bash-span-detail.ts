import { programNameOf, type ToolSpanDetail } from '@dltech/atlas-core'

export enum EBashExecOutcome {
  Ok = 'ok',
  Exit = 'exit',
  Oom = 'oom',
  Timeout = 'timeout',
  Cancelled = 'cancelled',
  Backgrounded = 'backgrounded',
}

export const bashExecOutcomeOf = (args: {
  oomKilled: boolean
  timedOut: boolean
  exitCode: number
}): EBashExecOutcome => {
  if (args.oomKilled) return EBashExecOutcome.Oom
  if (args.timedOut) return EBashExecOutcome.Timeout
  return args.exitCode === 0 ? EBashExecOutcome.Ok : EBashExecOutcome.Exit
}

export const bashSpanDetailOf = (args: {
  command: string
  outcome: EBashExecOutcome
  exitCode?: number | undefined
  durationMs: number
}): ToolSpanDetail => ({
  'exec.outcome': args.outcome,
  ...(args.exitCode === undefined ? {} : { 'exec.exitCode': args.exitCode }),
  'exec.durationMs': Math.round(args.durationMs),
  'exec.program': programNameOf(args.command),
})
