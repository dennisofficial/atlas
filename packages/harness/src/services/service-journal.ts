import type { EventDraft, EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'

export type ServiceStartRecording = {
  log: Pick<EventLogPort, 'append'>
  ids: Pick<IdPort, 'nextRunId'>
}

export enum EServiceJournalSkip {
  Failed = 'failed',
  Ended = 'ended',
  Superseded = 'superseded',
}

export type ServiceJournalAppend = { appended: true } | { appended: false; reason: EServiceJournalSkip }

enum EServiceRecord {
  Start = 'start',
  Ending = 'ending',
}

type ServiceKey = { threadId: ThreadId; serviceId: string }

type ServiceWrite = ServiceKey & { kind: EServiceRecord; draft: EventDraft }

const keyOf = ({ threadId, serviceId }: ServiceKey): string => `${threadId}\u0000${serviceId}`

export class ServiceEventJournal {
  private readonly recording: ServiceStartRecording
  private readonly warn: (message: string) => void
  private readonly tails = new Map<string, Promise<void>>()
  private readonly terminal = new Set<string>()
  private readonly disowned = new Set<string>()
  private readonly endingWrites = new Map<string, Promise<ServiceJournalAppend>>()
  private readonly failedEndings = new Set<string>()

  constructor(args: { recording: ServiceStartRecording; warn: (message: string) => void }) {
    this.recording = args.recording
    this.warn = args.warn
  }

  started(args: ServiceKey & { draft: EventDraft }): Promise<ServiceJournalAppend> {
    return this.enqueue({ ...args, kind: EServiceRecord.Start })
  }

  ended(args: ServiceKey & { draft: EventDraft }): Promise<ServiceJournalAppend> {
    const key = keyOf(args)
    if (this.endingWrites.has(key) && !this.failedEndings.has(key)) {
      return Promise.resolve({ appended: false, reason: EServiceJournalSkip.Ended })
    }
    this.failedEndings.delete(key)
    this.terminal.add(key)
    const ending = this.enqueue({ ...args, kind: EServiceRecord.Ending })
    this.endingWrites.set(key, ending)
    void ending.then((result) => {
      if (!result.appended && result.reason === EServiceJournalSkip.Failed) {
        this.failedEndings.add(key)
      }
    })
    return ending
  }

  needsRetry(args: ServiceKey): boolean {
    return this.failedEndings.has(keyOf(args))
  }

  disown(args: ServiceKey): void {
    this.disowned.add(keyOf(args))
  }

  private enqueue(args: ServiceWrite): Promise<ServiceJournalAppend> {
    const key = keyOf(args)
    if (this.disowned.has(key)) {
      return Promise.resolve({ appended: false, reason: EServiceJournalSkip.Superseded })
    }
    if (this.terminal.has(key) && args.kind !== EServiceRecord.Ending) {
      return Promise.resolve({ appended: false, reason: EServiceJournalSkip.Ended })
    }

    const prior = this.tails.get(key) ?? Promise.resolve()
    const result = prior.then(() => this.write(args))
    const tail = result.then(() => undefined)
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }

  private async write(args: ServiceWrite): Promise<ServiceJournalAppend> {
    if (this.disowned.has(keyOf(args))) {
      return { appended: false, reason: EServiceJournalSkip.Superseded }
    }
    try {
      await this.recording.log.append({
        threadId: args.threadId,
        runId: this.recording.ids.nextRunId(),
        drafts: [args.draft],
      })
      return { appended: true }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      this.warn(`could not record service ${args.kind} for ${args.serviceId}: ${reason}`)
      return { appended: false, reason: EServiceJournalSkip.Failed }
    }
  }
}
