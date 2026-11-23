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
  toolRunning: boolean
  agentsRunning: number
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
  setupRunning?: boolean | undefined
  agentsRunning?: number | undefined
}): PodBusyFacts => ({
  shellsRunning: args.shellsRunning,
  servicesRunning: args.servicesRunning,
  setupRunning: args.setupRunning === true || args.state === ESessionStatus.Preparing,
  turnInFlight: args.state !== undefined && TURN_STATES.has(args.state),
  toolRunning: args.state === ESessionStatus.RunningTool,
  agentsRunning: args.agentsRunning ?? 0,
})

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

const podProcessesOf = (facts: PodBusyFacts): string[] => {
  const running: string[] = []
  if (facts.setupRunning) running.push('Setup script')
  if (facts.shellsRunning > 0) running.push(plural(facts.shellsRunning, 'shell', 'shells'))
  if (facts.servicesRunning > 0) running.push(plural(facts.servicesRunning, 'service', 'services'))
  return running
}

const busyOf = (running: readonly string[]): PodBusy => ({ busy: running.length > 0, running })

export const podBusyOf = (facts: PodBusyFacts): PodBusy => {
  const running = podProcessesOf(facts)
  if (facts.turnInFlight) running.push('Agent turn')
  return busyOf(running)
}

export const podResizeBusyOf = (facts: PodBusyFacts): PodBusy => {
  const running = podProcessesOf(facts)
  if (facts.toolRunning) running.push('Tool call')
  if (facts.agentsRunning > 0) running.push(plural(facts.agentsRunning, 'sub-agent', 'sub-agents'))
  return busyOf(running)
}

export enum EPodRebootHold {
  Preparing = 'preparing',
  Setup = 'setup',
  RunningTool = 'running-tool',
  Shells = 'shells',
  Services = 'services',
  BackgroundAgents = 'background-agents',
  Terminals = 'terminals',
  Peers = 'peers',
}

export type PodRebootFacts = {
  state: ESessionStatus | undefined
  setupRunning: boolean
  shellsRunning: number
  servicesRunning: number
  backgroundAgents: number
  terminalsHeld: number
  peersPlaced: number
}

export type PodRebootSafety = {
  safe: boolean
  holds: readonly EPodRebootHold[]
}

export const podRebootSafeOf = (facts: PodRebootFacts): PodRebootSafety => {
  const holds: EPodRebootHold[] = []
  if (facts.state === ESessionStatus.Preparing) holds.push(EPodRebootHold.Preparing)
  if (facts.setupRunning) holds.push(EPodRebootHold.Setup)
  if (facts.state === ESessionStatus.RunningTool) holds.push(EPodRebootHold.RunningTool)
  if (facts.shellsRunning > 0) holds.push(EPodRebootHold.Shells)
  if (facts.servicesRunning > 0) holds.push(EPodRebootHold.Services)
  if (facts.backgroundAgents > 0) holds.push(EPodRebootHold.BackgroundAgents)
  if (facts.terminalsHeld > 0) holds.push(EPodRebootHold.Terminals)
  if (facts.peersPlaced > 0) holds.push(EPodRebootHold.Peers)
  return { safe: holds.length === 0, holds }
}
