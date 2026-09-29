import type { EventDraft } from '../events/body'
import type { Event } from '../events/envelope'
import type { ThreadId, RunId } from '../events/ids'

export abstract class EventLogPort {
  abstract append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]>

  /**
   * The thread's own events become exactly these drafts, re-stamped (fresh ids, seqs from 1, the
   * given run, a fresh timestamp): a move of the log's home replaces the destination wholesale,
   * never appends onto a snapshot that could have drifted.
   */
  abstract replace(args: {
    threadId: ThreadId
    runId: RunId
    drafts: readonly EventDraft[]
  }): Promise<Event[]>

  abstract read(args: { threadId: ThreadId; fromSeq?: number; upTo?: number }): Promise<Event[]>

  /**
   * Drops any cached read of the thread and re-reads it from the durable log. A lift restores the
   * transcript out of band (the archive extracts onto the session directory), so a reader that
   * cached the pre-restore log must refresh before it can serve the restored events. Ports that
   * never cache may answer with a no-op.
   */
  abstract refresh(args: { threadId: ThreadId }): Promise<void>

  abstract head(args: { threadId: ThreadId }): Promise<number>

  abstract readOwn(args: { threadId: ThreadId; fromSeq?: number; upTo?: number }): Promise<Event[]>
}
