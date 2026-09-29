import type { EventDraft, EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'

export type TeardownSource = {
  closeAll(): Promise<void>
  threadsAwaitingNotice(): readonly ThreadId[]
  drainNotifications(args: { threadId: ThreadId }): readonly EventDraft[]
}

export type TeardownShellSource = TeardownSource & {
  threadsWithUnresolvedEndings(): readonly ThreadId[]
  recordEndings(args: {
    log: EventLogPort
    ids: IdPort
    threadId: ThreadId
  }): Promise<unknown>
}

const isShellSource = (source: TeardownSource): source is TeardownShellSource =>
  'recordEndings' in source

export async function teardownSession(args: {
  sources: readonly TeardownSource[]
  log: EventLogPort
  ids: IdPort
  stopSandbox: () => Promise<unknown>
}): Promise<void> {
  try {
    await Promise.all(args.sources.map((source) => source.closeAll()))

    // Drain before reconciling: the drain reads each ended shell's output out of its in-memory
    // buffer and appends it to the log, so by the time recordEndings runs the log holds every end
    // the queue was carrying, and what is still missing is genuinely unrecorded. Draining after the
    // reconcile would have recordEndings re-synthesize ends the very next step was about to persist.
    for (const source of args.sources) {
      for (const threadId of source.threadsAwaitingNotice()) {
        const drafts = source.drainNotifications({ threadId })
        if (drafts.length === 0) continue

        await args.log.append({ threadId, runId: args.ids.nextRunId(), drafts })
      }
    }

    for (const source of args.sources) {
      if (!isShellSource(source)) continue
      for (const threadId of source.threadsWithUnresolvedEndings()) {
        await source.recordEndings({ log: args.log, ids: args.ids, threadId })
      }
    }
  } finally {
    await args.stopSandbox().catch(() => undefined)
  }
}
