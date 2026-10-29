import { formatElapsed } from '@dltech/atlas-client/transcript'
import {
  EKilledBy,
  EServiceStatus,
  EShellStatus,
  type ServiceSnapshotWire,
  type ShellSnapshotWire,
} from '@dltech/atlas-wire/web'

export enum EProcessKind {
  Shell = 'shell',
  Service = 'service',
}

export type ProcessRef = { kind: EProcessKind; id: string }

export enum EProcessTone {
  Running = 'running',
  Waiting = 'waiting',
  Failed = 'failed',
  Settled = 'settled',
}

export const PEEKED_CHARACTERS = 64_000

export const SERVICE_LOG_POLL_MS = 5_000

export const SHELL_READ_GAP_MS = 500

const READOUT_SEPARATOR = ' · '

const ESCAPE_SEQUENCE =
  /\x1B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[()][0-2]?|[@-Z\\-_])/g

export const plainLogOf = (text: string): string =>
  text.replace(ESCAPE_SEQUENCE, '').replace(/\r/g, '')

export const ownShellsOf = (args: {
  shells: readonly ShellSnapshotWire[]
  threadId: string
}): ShellSnapshotWire[] => args.shells.filter((shell) => shell.threadId === args.threadId)

export const isShellRunning = (shell: ShellSnapshotWire): boolean =>
  shell.status === EShellStatus.Running

export const isServiceRunning = (service: ServiceSnapshotWire): boolean =>
  service.status === EServiceStatus.Running

const collapsed = (command: string): string => command.replace(/\s+/g, ' ').trim()

export const processNameOf = (process: { command: string; description: string }): string => {
  const named = process.description.trim()
  return named === '' ? collapsed(process.command) : named
}

export const processCommandOf = (process: {
  command: string
  description: string
}): string | undefined =>
  process.description.trim() === '' ? undefined : collapsed(process.command)

function shellStateLabel(shell: ShellSnapshotWire): string {
  if (shell.status === EShellStatus.Running) {
    return shell.awaitingInput ? 'awaiting input' : 'running'
  }
  if (shell.status === EShellStatus.Killed) {
    if (shell.killedBy === EKilledBy.User) return 'killed by you'
    if (shell.killedBy === EKilledBy.Timeout) return 'timed out'
    if (shell.killedBy === EKilledBy.LostContact) return 'lost contact'
    return 'killed'
  }
  if (shell.status === EShellStatus.Overflowed) return 'killed — too much output'
  if (shell.exitCode === undefined || shell.exitCode === 0) return 'done'
  return `exit ${shell.exitCode}`
}

function serviceStateLabel(service: ServiceSnapshotWire): string {
  if (service.status === EServiceStatus.Running) return 'running'
  if (service.status === EServiceStatus.Killed) {
    if (service.killedBy === EKilledBy.User) return 'stopped by you'
    if (service.killedBy === EKilledBy.Model) return 'stopped by atlas'
    if (service.killedBy === EKilledBy.SessionEnd) return 'stopped at session end'
    return 'stopped'
  }
  if (service.exitCode === undefined || service.exitCode === 0) return 'exited'
  return `exit ${service.exitCode}`
}

const instantOf = (iso: string | undefined): number | null => {
  if (iso === undefined) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

const withElapsed = (args: {
  state: string
  startedAt: string
  endedAt: number | null
  now: number
}): string => {
  const started = instantOf(args.startedAt)
  if (started === null) return args.state
  const elapsed = Math.max(0, (args.endedAt ?? args.now) - started)
  return `${args.state}${READOUT_SEPARATOR}${formatElapsed(elapsed)}`
}

export function shellReadoutOf(args: { shell: ShellSnapshotWire; now: number }): string {
  const { shell } = args
  const state = shellStateLabel(shell)
  if (shell.awaitingInput) return state
  const endedAt = isShellRunning(shell) ? null : instantOf(shell.endedAt ?? shell.lastOutputAt)
  return withElapsed({ state, startedAt: shell.startedAt, endedAt, now: args.now })
}

export function serviceReadoutOf(args: { service: ServiceSnapshotWire; now: number }): string {
  const { service } = args
  const endedAt = isServiceRunning(service) ? null : instantOf(service.endedAt)
  return withElapsed({
    state: serviceStateLabel(service),
    startedAt: service.startedAt,
    endedAt,
    now: args.now,
  })
}

const failedExit = (exitCode: number | undefined): boolean =>
  exitCode !== undefined && exitCode !== 0

export function shellToneOf(shell: ShellSnapshotWire): EProcessTone {
  if (shell.awaitingInput) return EProcessTone.Waiting
  if (isShellRunning(shell)) return EProcessTone.Running
  if (shell.status === EShellStatus.Overflowed || failedExit(shell.exitCode)) {
    return EProcessTone.Failed
  }
  return EProcessTone.Settled
}

export function serviceToneOf(service: ServiceSnapshotWire): EProcessTone {
  if (isServiceRunning(service)) return EProcessTone.Running
  return failedExit(service.exitCode) ? EProcessTone.Failed : EProcessTone.Settled
}
