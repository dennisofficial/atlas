import type { EKilledBy, EventDraft, ThreadId } from '@dltech/atlas-core'
import {
  ShellRegistryPort,
  type PendingShellNotice,
  type ShellKillOutcome,
  type ShellReadOutcome,
  type ShellSnapshot,
  type StartedShellOutcome,
  type StartShellArgs,
} from '@dltech/atlas-harness'

const UNAVAILABLE = 'background shells are not available in this session yet'

export class ForegroundOnlyShells extends ShellRegistryPort {
  start(_args: StartShellArgs): StartedShellOutcome {
    return { ok: false, reason: UNAVAILABLE }
  }

  read(_args: { shellId: string; threadId: ThreadId }): ShellReadOutcome {
    return { ok: false, reason: UNAVAILABLE }
  }

  peek(_args: { shellId: string; characters: number; threadId: ThreadId }): string | undefined {
    return undefined
  }

  kill(_args: { shellId: string; by: EKilledBy; threadId: ThreadId }): ShellKillOutcome {
    return { ok: false, reason: UNAVAILABLE }
  }

  async awaitEndings(_args: { threadId: ThreadId; ms: number }): Promise<number> {
    return 0
  }

  removeShells(_args: { threadId: ThreadId; shellIds: readonly string[]; by: EKilledBy }): void {}

  list(_args: { threadId: ThreadId }): readonly ShellSnapshot[] {
    return []
  }

  listEverywhere(): readonly ShellSnapshot[] {
    return []
  }

  version(): number {
    return 0
  }

  subscribe(): () => void {
    return () => undefined
  }

  drainNotifications(_args: { threadId: ThreadId }): readonly EventDraft[] {
    return []
  }

  pendingNotices(_args: { threadId: ThreadId }): readonly PendingShellNotice[] {
    return []
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return []
  }

  onNotice(): () => void {
    return () => undefined
  }

  forgetNotices(_args: { threadId: ThreadId }): void {}

  reassignNotices(_args: { from: ThreadId; to: ThreadId }): void {}

  async closeAll(_args?: { killedBy?: EKilledBy; threadId?: ThreadId }): Promise<void> {}
}
