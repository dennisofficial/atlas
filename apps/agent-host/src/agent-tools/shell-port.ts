import type { EKilledBy, EShellStatus, EventDraft, ThreadId } from '@dltech/atlas-core'

export type ShellSnapshot = {
  shellId: string
  threadId: ThreadId
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
  outputPath?: string | undefined
}

export type ShellDelta = {
  text: string
  droppedCharacters: number
  remainingCharacters: number
}

export type SettledShellOutcome =
  | { died: true; snapshot: ShellSnapshot; delta: ShellDelta }
  | { died: false }

export type StartShellArgs = {
  threadId: ThreadId
  command: string
  description: string
  cwd?: string | undefined
  watch?: string | undefined
  timeoutMs?: number | undefined
}

export type StartedShellOutcome =
  | { ok: true; snapshot: ShellSnapshot }
  | { ok: false; reason: string }

export type ShellKillOutcome =
  | {
      ok: true
      snapshot: ShellSnapshot
      settled?: Promise<SettledShellOutcome> | undefined
    }
  | { ok: false; reason: string }

export type ShellReadOutcome =
  | { ok: true; snapshot: ShellSnapshot; delta: ShellDelta }
  | { ok: false; reason: string }

export enum ENotice {
  Ended = 'ended',
  AwaitingInput = 'awaiting-input',
  Matched = 'matched',
}

export type PendingShellNotice = { kind: ENotice; snapshot: ShellSnapshot }

export abstract class ShellRegistryPort {
  abstract start(args: StartShellArgs): Promise<StartedShellOutcome> | StartedShellOutcome
  abstract read(args: {
    shellId: string
    threadId: ThreadId
  }): Promise<ShellReadOutcome> | ShellReadOutcome
  abstract peek(args: {
    shellId: string
    characters: number
    threadId: ThreadId
  }): Promise<string | undefined> | string | undefined
  abstract kill(args: {
    shellId: string
    by: EKilledBy
    threadId: ThreadId
  }): Promise<ShellKillOutcome> | ShellKillOutcome
  abstract awaitEndings(args: { threadId: ThreadId; ms: number }): Promise<number>
  abstract removeShells(args: {
    threadId: ThreadId
    shellIds: readonly string[]
    by: EKilledBy
  }): Promise<void> | void
  abstract list(args: { threadId: ThreadId }): readonly ShellSnapshot[]
  abstract listEverywhere(): readonly ShellSnapshot[]
  abstract version(): number
  abstract subscribe(listener: () => void): () => void
  abstract drainNotifications(args: { threadId: ThreadId }): readonly EventDraft[]
  abstract pendingNotices(args: { threadId: ThreadId }): readonly PendingShellNotice[]
  abstract threadsAwaitingNotice(): readonly ThreadId[]
  abstract onNotice(listener: () => void): () => void
  abstract forgetNotices(args: { threadId: ThreadId }): void
  abstract reassignNotices(args: { from: ThreadId; to: ThreadId }): void
  abstract closeAll(args?: { killedBy?: EKilledBy; threadId?: ThreadId }): Promise<void>
}
