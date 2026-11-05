import type { ThreadId, WaitingForModel } from '@dltech/atlas-core'

export type SleepPrevention = { acquire(): () => void }

export type ModelWaitObserver = {
  observe(args: { threadId: ThreadId; waiting: WaitingForModel }): Promise<void>
  admitted(args: { threadId: ThreadId }): Promise<void>
  blocked(args: { threadId: ThreadId }): boolean
}
