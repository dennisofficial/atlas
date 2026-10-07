import type { EKilledBy, EShellStatus, EventDraft, ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from '../intake/input-batch'
import { stopShellOwners, type StopShellOwners } from './lifecycle-operations'
import type { PendingShellNotice } from './attention'
import type {
  ShellInputOutcome,
  ShellKillOutcome,
  ShellDelta,
  ShellSnapshot,
  StartedShellOutcome,
  StartShellArgs,
} from './background-shell'
import type { ShellId } from './shell-id'

export type ShellReadOutcome =
  | { ok: true; snapshot: ShellSnapshot; delta: ShellDelta }
  | { ok: false; reason: string }

export type LostShell = {
  shellId: string
  command: string
  description?: string | undefined
  reason?: string | undefined
}

export type ShellExit = {
  status: EShellStatus
  killedBy?: EKilledBy | undefined
  exitCode?: number | undefined
  endedAt?: string | undefined
  totalBytes: number
}

export type ShellAttachment = {
  readonly shellId: ShellId
  readonly startedAt: string
  readonly pid?: number | undefined
  readonly outputPath: string
  readonly cursorPath: string
  readonly inputSupported: boolean
  totalBytes(): number
  readOutput(args: { start: number; limit: number }): Promise<Uint8Array>
  writeInput(args: { text: string; end?: boolean | undefined }): Promise<ShellInputOutcome>
  kill(by: EKilledBy): void
  watch(args: { onOutput: (totalBytes: number) => void; onExit: (exit: ShellExit) => void }): void
  detach(): Promise<void>
}

export type ShellLaunchSpec = {
  threadId: ThreadId
  command: string
  description: string
  cwd: string
  timeoutMs?: number | undefined
  outputLimitBytes?: number | undefined
  silenceMs: number
}

export type ShellLaunchOutcome =
  | { ok: true; attachment: ShellAttachment }
  | { ok: false; reason: string }

export enum EInspected {
  Live = 'live',
  Finished = 'finished',
  Corrupt = 'corrupt',
}

export type InspectedShell =
  | { state: EInspected.Live; shellId: ShellId; attachment: ShellAttachment }
  | { state: EInspected.Finished; shellId: ShellId; attachment: ShellAttachment; exit: ShellExit }
  | { state: EInspected.Corrupt; shellId: ShellId; reason: string }

export abstract class ShellLauncherPort {
  abstract launch(spec: ShellLaunchSpec): Promise<ShellLaunchOutcome>
  abstract inspect(args: { threadId: ThreadId }): Promise<readonly InspectedShell[]>
}

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
  abstract kill(args: { shellId: string; by: EKilledBy; threadId: ThreadId }): ShellKillOutcome
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
  settling?(): boolean
  onSettled?(listener: () => void): () => void
  abstract drainNotifications(args: { threadId: ThreadId }): readonly EventDraft[]
  prepareNotifications?(args: { threadId: ThreadId }): InputBatch
  abstract pendingNotices(args: { threadId: ThreadId }): readonly PendingShellNotice[]
  abstract threadsAwaitingNotice(): readonly ThreadId[]
  threadsWithPendingInput?(): readonly ThreadId[]
  abstract onNotice(listener: () => void): () => void
  abstract forgetNotices(args: { threadId: ThreadId }): void
  /**
   * Moves a finished thread's pending notices to a live one. The owning thread is only a return
   * address — when it ends, the parent inherits the mailbox.
   */
  abstract reassignNotices(args: { from: ThreadId; to: ThreadId }): void
  abstract closeAll(args?: { killedBy?: EKilledBy; threadId?: ThreadId }): Promise<void>

  stopOwners(args: StopShellOwners): Promise<readonly ShellSnapshot[]> {
    return stopShellOwners({ shells: this, owners: args })
  }

  writeInput(_args: {
    threadId: ThreadId
    shellId: string
    text: string
    end?: boolean | undefined
  }): Promise<ShellInputOutcome> {
    return Promise.resolve({ ok: false, reason: 'this registry does not accept input for shells' })
  }

  detachAll(): Promise<void> {
    return Promise.resolve()
  }

  reconcile(_args: { threadId: ThreadId; ownOnly?: boolean }): Promise<readonly LostShell[]> {
    return Promise.resolve([])
  }
}
