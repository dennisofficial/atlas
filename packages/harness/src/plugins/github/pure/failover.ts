import { EPullRequestLookup, type PullRequestReading } from './port'

export const PROBE_INTERVAL_MS = 60_000

export enum EFailoverState {
  Realtime = 'realtime',
  Polling = 'polling',
}

export enum EFailoverDecision {
  ReturnAsIs = 'return-as-is',
  FlipThenAnswer = 'flip-then-answer',
  AskFallback = 'ask-fallback',
}

export const failoverDecision = (args: {
  state: EFailoverState
  reading: PullRequestReading | null
}): EFailoverDecision => {
  if (args.state === EFailoverState.Polling) return EFailoverDecision.AskFallback
  if (args.reading === null) return EFailoverDecision.ReturnAsIs
  if (args.reading.lookup !== EPullRequestLookup.Unavailable) return EFailoverDecision.ReturnAsIs

  return args.reading.retryable ? EFailoverDecision.FlipThenAnswer : EFailoverDecision.ReturnAsIs
}

export const isRealAnswer = (reading: PullRequestReading): boolean =>
  reading.lookup !== EPullRequestLookup.Unavailable

export const probeDue = (args: { lastProbeAt: number; now: number }): boolean =>
  args.now - args.lastProbeAt >= PROBE_INTERVAL_MS
