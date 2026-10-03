import {
  EKilledBy,
  EShellStatus,
  type PortExposure,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ShellAttachment } from './port'
import type { ShellId } from './shell-id'

export { EKilledBy, EShellStatus }

export type ShellSnapshot = {
  shellId: ShellId
  threadId: ThreadId
  bootId?: string | undefined
  command: string
  description: string
  status: EShellStatus
  killedBy?: EKilledBy | undefined
  pid?: number | undefined
  exitCode?: number | undefined
  startedAt: string
  lastOutputAt: string
  endedAt?: string | undefined
  totalCharacters: number
  awaitingInput: boolean
  exposure?: PortExposure | undefined
  outputPath?: string | undefined
  inputSupported?: boolean | undefined
}

export type ShellDelta = {
  text: string
  droppedCharacters: number
  remainingCharacters: number
  outputStart?: number | undefined
  outputEnd?: number | undefined
}

export type ShellWindow = ShellDelta & { outputStart: number; outputEnd: number }

export type ShellInputOutcome = { ok: true } | { ok: false; reason: string }

export type BackgroundShell = {
  readonly shellId: ShellId
  readonly exited: Promise<void>
  readonly attachment?: ShellAttachment | undefined
  snapshot(): ShellSnapshot
  preview(limit: number): Promise<ShellWindow>
  consume(limit: number): Promise<ShellWindow>
  acknowledge(to: number): void
  tail(limit: number): Promise<string>
  writeInput(args: { text: string; end?: boolean | undefined }): Promise<ShellInputOutcome>
  kill(by: EKilledBy): void
  detach(): Promise<void>
}

export type StartShellArgs = {
  threadId: ThreadId
  command: string
  description: string
  cwd?: string | undefined
  watch?: string | undefined
  timeoutMs?: number | undefined
  outputLimitBytes?: number | undefined
  exposure?: PortExposure | undefined
}

export type StartedShellOutcome =
  | { ok: true; snapshot: ShellSnapshot }
  | { ok: false; reason: string }

export type SettledShellOutcome =
  | { died: true; snapshot: ShellSnapshot; delta: ShellDelta }
  | { died: false }

export type ShellKillOutcome =
  | { ok: true; snapshot: ShellSnapshot; settled?: Promise<SettledShellOutcome> | undefined }
  | { ok: false; reason: string }
