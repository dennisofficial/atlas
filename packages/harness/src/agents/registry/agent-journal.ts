import type { EventDraft, EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'

export type Recorded = { recorded: true } | { recorded: false; cause: string }

const causeOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

export class AgentJournal {
  private readonly log: EventLogPort
  private readonly ids: IdPort

  constructor(args: { log: EventLogPort; ids: IdPort }) {
    this.log = args.log
    this.ids = args.ids
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
