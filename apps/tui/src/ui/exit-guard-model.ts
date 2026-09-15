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
  Detach = 'detach',
  Stay = 'stay',
}

export { AGENT_TAG, SERVICE_TAG, SHELL_TAG } from './stop-guard-model'

export type ExitGuardRow = StopGuardRow

export type ExitGuardOption = StopGuardOption<EExitChoice>

export type ExitGuardState = StopGuardState

export const DETACH_NOTE = 'coming soon'

export const EXIT_GUARD_OPTIONS: readonly ExitGuardOption[] = Object.freeze([
  { choice: EExitChoice.StopAndExit, label: 'Exit and stop tasks', enabled: true },
  {
    choice: EExitChoice.Detach,
    label: 'Move to background and exit',
    enabled: false,
    note: DETACH_NOTE,
  },
  { choice: EExitChoice.Stay, label: 'Stay', enabled: true },
])

export const exitGuardRow = shellStopRow

export const exitGuardServiceRow = serviceStopRow

export const exitGuardAgentRow = agentStopRow

export function openExitGuard(): ExitGuardState {
  return openStopGuard({ options: EXIT_GUARD_OPTIONS })
}

export function selectedOption(state: ExitGuardState): ExitGuardOption | undefined {
  return selectedStopGuardOption({ options: EXIT_GUARD_OPTIONS, state })
}

export function moveSelection(args: { state: ExitGuardState; delta: number }): ExitGuardState {
  return moveStopGuardSelection({ options: EXIT_GUARD_OPTIONS, ...args })
}

export function resolve(state: ExitGuardState): EExitChoice | null {
  return resolveStopGuard({ options: EXIT_GUARD_OPTIONS, state })
}
