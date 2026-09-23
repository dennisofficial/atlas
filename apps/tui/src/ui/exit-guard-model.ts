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

export const DETACH_NOTE =
  'turn keeps running; filesystem persists via snapshot; services die on park'

export const DETACH_EXIT_LINE = `detached — ${DETACH_NOTE}`

const LOCAL_OPTIONS: readonly ExitGuardOption[] = Object.freeze([
  { choice: EExitChoice.StopAndExit, label: 'Exit and stop tasks', enabled: true },
  { choice: EExitChoice.Stay, label: 'Stay', enabled: true },
])

const CLOUD_OPTIONS: readonly ExitGuardOption[] = Object.freeze([
  {
    choice: EExitChoice.Detach,
    label: 'Move to background and exit',
    enabled: true,
    note: DETACH_NOTE,
  },
  { choice: EExitChoice.Stay, label: 'Stay', enabled: true },
])

/**
 * Detaching is a cloud promise — the sandbox outlives the window — so a local conversation never
 * sees it, and a cloud one never sees "stop tasks": exiting cannot stop what runs on the sandbox.
 */
export function exitGuardOptions(args: { cloud: boolean }): readonly ExitGuardOption[] {
  return args.cloud ? CLOUD_OPTIONS : LOCAL_OPTIONS
}

export const exitGuardRow = shellStopRow

export const exitGuardServiceRow = serviceStopRow

export const exitGuardAgentRow = agentStopRow

export function openExitGuard(args: { options: readonly ExitGuardOption[] }): ExitGuardState {
  return openStopGuard({ options: args.options })
}

export function selectedOption(args: {
  options: readonly ExitGuardOption[]
  state: ExitGuardState
}): ExitGuardOption | undefined {
  return selectedStopGuardOption(args)
}

export function moveSelection(args: {
  options: readonly ExitGuardOption[]
  state: ExitGuardState
  delta: number
}): ExitGuardState {
  return moveStopGuardSelection(args)
}

export function resolve(args: {
  options: readonly ExitGuardOption[]
  state: ExitGuardState
}): EExitChoice | null {
  return resolveStopGuard(args)
}
