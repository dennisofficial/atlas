import type { EventDraft, EventLogPort, IdPort, ThreadId } from '@dltech/atlas-core'
import type { InputBatch, MessageIntake } from '../intake'
import { flushThreadInput } from './flush-session-input'

export type TeardownSource = {
  closeAll(): Promise<void>
  threadsAwaitingNotice(): readonly ThreadId[]
  drainNotifications(args: { threadId: ThreadId }): readonly EventDraft[]
  prepareNotifications?: ((args: { threadId: ThreadId }) => InputBatch) | undefined
  threadsWithPendingInput?: (() => readonly ThreadId[]) | undefined
}

export async function teardownSession(args: {
  sources: readonly TeardownSource[]
  log: EventLogPort
  ids: IdPort
  stopSandbox: () => Promise<unknown>
  intake?: MessageIntake | undefined
}): Promise<void> {
  const failures: unknown[] = []
  const attempt = async (action: () => Promise<unknown>): Promise<void> => {
    try { await action() } catch (error) { failures.push(error) }
  }
  try {
    await Promise.all(args.sources.map((source) => attempt(() => source.closeAll())))
    const intake = args.intake
    if (intake !== undefined) {
      for (const threadId of intake.threadsWithPendingInput()) {
        await attempt(() => flushThreadInput({ intake, log: args.log, ids: args.ids, threadId }))
      }
    }
    const delivery: readonly TeardownSource[] = intake === undefined ? args.sources : []
    for (const source of delivery) {
      for (const threadId of source.threadsWithPendingInput?.() ?? source.threadsAwaitingNotice()) {
        await attempt(async () => {
          const prepared = source.prepareNotifications?.({ threadId })
          try {
            const drafts = prepared?.drafts ?? source.drainNotifications({ threadId })
            if (drafts.length > 0) await args.log.append({ threadId, runId: args.ids.nextRunId(), drafts })
            prepared?.acknowledge()
          } finally {
            prepared?.release?.()
          }
        })
      }
    }
  } finally {
    await attempt(args.stopSandbox)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'could not persist every session ending')
}
