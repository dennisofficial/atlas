import {
  arrivedDraft,
  deliveredDraft,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

export type StampedNotice = { arrived: EventDraft; delivered: EventDraft }

export type Recorded = { recorded: true } | { recorded: false; cause: string }

const causeOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

export class AgentJournal {
  private readonly log: EventLogPort
  private readonly ids: IdPort

  constructor(args: { log: EventLogPort; ids: IdPort }) {
    this.log = args.log
    this.ids = args.ids
  }

  stamp({ draft }: { draft: EventDraft }): StampedNotice {
    const id = String(this.ids.nextEventId())
    return { arrived: arrivedDraft({ draft, id }), delivered: deliveredDraft({ draft, id }) }
  }

  async record({ threadId, draft }: { threadId: ThreadId; draft: EventDraft }): Promise<Recorded> {
    const runId = this.ids.nextRunId()
    try {
      await this.log.append({ threadId, runId, drafts: [draft] })
      return { recorded: true }
    } catch (cause) {
      const landed = await this.log
        .readOwn({ threadId })
        .then((events) => events.some((event) => event.runId === runId))
        .catch(() => false)
      return landed ? { recorded: true } : { recorded: false, cause: causeOf(cause) }
    }
  }
}
