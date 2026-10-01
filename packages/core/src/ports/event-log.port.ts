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

  /** Invalidates cached logs for the thread's session and re-reads the thread; uncached stores may do nothing. */
  abstract refresh(args: { threadId: ThreadId }): Promise<void>

  abstract head(args: { threadId: ThreadId }): Promise<number>

  abstract readOwn(args: { threadId: ThreadId; fromSeq?: number; upTo?: number }): Promise<Event[]>
}
