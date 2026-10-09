import type { EKilledBy, EStopAction, EventDraft, ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from '../intake/input-batch'
import type { ServiceSnapshot } from './service-process'

export type StartedServiceOutcome =
  | { ok: true; snapshot: ServiceSnapshot }
  | { ok: false; reason: string }

export type ServiceStopOutcome =
  | { ok: true; snapshot: ServiceSnapshot; action: EStopAction }
  | { ok: false; reason: string }

/**
 * A service is session-wide infrastructure rather than one thread's work: it outlives the turn that
 * started it by design, so any conversation may list or stop it. The starting thread is recorded
 * only so its ending routes to the log of the thread that started it.
 */
export abstract class ServiceRegistryPort {
  abstract start(args: {
    threadId: ThreadId
    command: string
    description: string
    cwd?: string | undefined
  }): Promise<StartedServiceOutcome>
  abstract stop(args: { serviceId: string; by: EKilledBy }): ServiceStopOutcome
  /**
   * A caller that just stopped services is already waiting, so the endings it caused should sit in
   * the notice queue when it moves on: an exit that lands after the caller's next drain would hang
   * in the queue for a whole model step. Waits, bounded per service by `ms`, for every signalled
   * service to record its exit, and answers how many had not — their endings announce whenever they
   * do exit, the same as any other ending.
   */
  abstract awaitEndings(args: { ms: number }): Promise<number>
  retryEndings?(args: { threadId?: ThreadId | undefined }): Promise<void>
  /**
   * A rewind disowns the services it cut: they die with the transcript that started them, and
   * their endings announce nothing — the rewound thread holds no tool call the announcement could
   * belong to. Removal is the exception to every ending announcing itself.
   */
  abstract removeServices(args: { serviceIds: readonly string[]; by: EKilledBy }): void
  abstract list(): readonly ServiceSnapshot[]
  hasRunningFor?(args: { threadId: ThreadId }): boolean
  abstract version(): number
  abstract subscribe(listener: () => void): () => void
  settling?(): boolean
  onSettled?(listener: () => void): () => void
  abstract drainNotifications(args: { threadId: ThreadId }): readonly EventDraft[]
  prepareNotifications?(args: { threadId: ThreadId }): InputBatch
  abstract pendingNotices(args: { threadId: ThreadId }): readonly ServiceSnapshot[]
  abstract threadsAwaitingNotice(): readonly ThreadId[]
  threadsWithPendingInput?(): readonly ThreadId[]
  abstract onNotice(listener: () => void): () => void
  abstract forgetNotices(args: { threadId: ThreadId }): void
  /**
   * Moves a finished thread's pending notices to a live one. Services are session-wide, so the
   * starting thread is only a return address — when it ends, the parent inherits the mailbox.
   */
  abstract reassignNotices(args: { from: ThreadId; to: ThreadId }): void
  abstract closeAll(args?: { killedBy?: EKilledBy }): Promise<void>
}
