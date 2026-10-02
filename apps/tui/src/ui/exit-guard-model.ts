import {
  agentStopRow,
  moveStopGuardSelection,
  openStopGuard,
  resolveStopGuard,
  selectedStopGuardOption,
  serviceStopRow,
  shellStopRow,
  type StopGuardOption,
  type StopGuardRow,
  type StopGuardState,
} from './stop-guard-model'

export enum EExitChoice {
  StopAndExit = 'stop-and-exit',
  Stay = 'stay',
}

export { AGENT_TAG, SERVICE_TAG, SHELL_TAG } from './stop-guard-model'

export type ExitGuardRow = StopGuardRow

export type ExitGuardOption = StopGuardOption<EExitChoice>

export type ExitGuardState = StopGuardState

export const EXIT_GUARD_OPTIONS: readonly ExitGuardOption[] = Object.freeze([
  { choice: EExitChoice.StopAndExit, label: 'Exit and stop tasks', enabled: true },
  { choice: EExitChoice.Stay, label: 'Stay', enabled: true },
])

export const exitGuardRow = shellStopRow

export const exitGuardServiceRow = serviceStopRow

export const exitGuardAgentRow = agentStopRow

export function openExitGuard(): ExitGuardState {
  return openStopGuard({ options: EXIT_GUARD_OPTIONS })
}

export function selectedOption(args: { state: ExitGuardState }): ExitGuardOption | undefined {
  return selectedStopGuardOption({ options: EXIT_GUARD_OPTIONS, state: args.state })
}

export function moveSelection(args: { state: ExitGuardState; delta: number }): ExitGuardState {
  return moveStopGuardSelection({ options: EXIT_GUARD_OPTIONS, state: args.state, delta: args.delta })
}

export function resolve(args: { state: ExitGuardState }): EExitChoice | null {
  return resolveStopGuard({ options: EXIT_GUARD_OPTIONS, state: args.state })
}
