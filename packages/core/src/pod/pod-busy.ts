import { ESessionStatus } from '../record/views/status-types'

export enum EPodBusyReason {
  Setup = 'setup',
  Shells = 'shells',
  Services = 'services',
  Turn = 'turn',
}

export type PodBusyFacts = {
  shellsRunning: number
  servicesRunning: number
  setupRunning: boolean
  turnInFlight: boolean
}

export type PodBusy = {
  busy: boolean
  running: readonly string[]
}

const TURN_STATES: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.Thinking,
  ESessionStatus.RunningTool,
  ESessionStatus.WaitingToRetry,
  ESessionStatus.Resuming,
  ESessionStatus.WaitingForBackground,
])

export const podBusyFactsOf = (args: {
  state: ESessionStatus | undefined
  shellsRunning: number
  servicesRunning: number
}): PodBusyFacts => ({
  shellsRunning: args.shellsRunning,
  servicesRunning: args.servicesRunning,
  setupRunning: args.state === ESessionStatus.Preparing,
  turnInFlight: args.state !== undefined && TURN_STATES.has(args.state),
})

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

export const podBusyOf = (facts: PodBusyFacts): PodBusy => {
  const running: string[] = []
  if (facts.setupRunning) running.push('Setup script')
  if (facts.shellsRunning > 0) running.push(plural(facts.shellsRunning, 'shell', 'shells'))
  if (facts.servicesRunning > 0) running.push(plural(facts.servicesRunning, 'service', 'services'))
  if (facts.turnInFlight) running.push('Agent turn')
  return { busy: running.length > 0, running }
}
