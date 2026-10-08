import type { EventDraft, ThreadId } from '@dltech/atlas-core'

import type { ServiceEventJournal } from './service-journal'
import { serviceEndedDraft, type ServiceNoticeQueue } from './service-notices'
import type { Service } from './service-process'

export type TrackedService = {
  service: Service
  threadId: ThreadId
  announced: boolean
  draft?: EventDraft | undefined
  ending?: Promise<void> | undefined
}

export class ServiceEndings {
  private readonly journal: ServiceEventJournal | undefined
  private readonly notices: ServiceNoticeQueue
  private readonly isCurrent: (entry: TrackedService) => boolean
  private readonly onAnnounced: () => void
  private readonly onChanged: () => void

  constructor(args: {
    journal: ServiceEventJournal | undefined
    notices: ServiceNoticeQueue
    isCurrent: (entry: TrackedService) => boolean
    onAnnounced: () => void
    onChanged: () => void
  }) {
    this.journal = args.journal
    this.notices = args.notices
    this.isCurrent = args.isCurrent
    this.onAnnounced = args.onAnnounced
    this.onChanged = args.onChanged
  }

  exited(entry: TrackedService): void {
    if (entry.announced || entry.ending !== undefined) return

    entry.draft = serviceEndedDraft({ snapshot: entry.service.snapshot() })
    if (this.journal === undefined) {
      this.announce(entry)
      return
    }
    void this.persist(entry)
  }

  needsRetry(entry: TrackedService): boolean {
    return (
      !entry.announced &&
      entry.ending === undefined &&
      entry.draft !== undefined &&
      this.journal?.needsRetry({
        threadId: entry.threadId,
        serviceId: entry.service.serviceId,
      }) === true
    )
  }

  disown(entry: TrackedService): void {
    this.journal?.disown({ threadId: entry.threadId, serviceId: entry.service.serviceId })
  }

  persist(entry: TrackedService): Promise<void> {
    const { journal } = this
    const { draft } = entry
    if (journal === undefined || draft === undefined || entry.ending !== undefined) {
      return entry.ending ?? Promise.resolve()
    }

    const ending: Promise<void> = journal
      .ended({ threadId: entry.threadId, serviceId: entry.service.serviceId, draft })
      .then((written) => {
        if (written.appended && this.isCurrent(entry)) this.announce(entry)
      })
      .finally(() => {
        if (!entry.announced && entry.ending === ending) entry.ending = undefined
        this.onChanged()
      })
    entry.ending = ending
    return ending
  }

  private announce(entry: TrackedService): void {
    const { draft } = entry
    if (entry.announced || draft === undefined) return

    entry.announced = true
    this.onAnnounced()
    this.notices.queue({ snapshot: entry.service.snapshot(), threadId: entry.threadId, draft })
  }
}
