import type { ThreadId } from '../events/ids'

export abstract class ThreadReadCursorPort {
  abstract readSeq(args: { threadId: ThreadId }): Promise<number | undefined>
  abstract markRead(args: { threadId: ThreadId; seq: number }): Promise<number>
}
