import type { Event, EventDraft, ThreadId } from '@dltech/atlas-core'

import type { InputBatch } from '../intake/input-batch'
import { requeueOwedServiceNotices } from './owed-notices'
import { ServiceNoticeQueue } from './service-notices'
import type { ServiceSnapshot } from './service-process'
import { ServiceRegistryPort } from './service-registry-port'
import { ServiceSupervisor, type Scheduler } from './service-supervisor'

export abstract class ServiceNoticeRegistry extends ServiceRegistryPort {
  protected readonly notices = new ServiceNoticeQueue()
  protected readonly supervisor: ServiceSupervisor

  constructor(args?: { scheduler?: Scheduler | undefined }) {
    super()
    this.supervisor = new ServiceSupervisor({ scheduler: args?.scheduler })
  }

  override suspendSupervision(): void {
    this.supervisor.suspend()
  }

  override resumeSupervision(): void {
    this.supervisor.resume()
  }

  override restartPending({ name }: { name: string }): boolean {
    return this.supervisor.isPending(name)
  }

  override crashLooping({ name }: { name: string }): boolean {
    return this.supervisor.crashLooping(name)
  }

  drainNotifications({ threadId }: { threadId: ThreadId }): readonly EventDraft[] {
    return this.notices.drain({ threadId })
  }

  override prepareNotifications({ threadId }: { threadId: ThreadId }): InputBatch {
    void this.retryEndings?.({ threadId })
    return this.notices.prepare({ threadId })
  }

  pendingNotices({ threadId }: { threadId: ThreadId }): readonly ServiceSnapshot[] {
    return this.notices.pending({ threadId })
  }

  threadsAwaitingNotice(): readonly ThreadId[] {
    return this.notices.threadsAwaiting()
  }

  override threadsWithPendingInput(): readonly ThreadId[] {
    return this.notices.threadsQueued()
  }

  onNotice(listener: () => void): () => void {
    return this.notices.onNotice(listener)
  }

  forgetNotices({ threadId }: { threadId: ThreadId }): void {
    this.notices.forget({ threadId })
  }

  override requeueOwed({
    events,
    threadId,
  }: {
    events: readonly Event[]
    threadId: ThreadId
  }): void {
    requeueOwedServiceNotices({ events, threadId, notices: this.notices })
  }

  reassignNotices({ from, to }: { from: ThreadId; to: ThreadId }): void {
    this.notices.reassign({ from, to })
  }
}
