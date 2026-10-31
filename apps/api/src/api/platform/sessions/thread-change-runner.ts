import { Logger } from '@nestjs/common'
import type { BackgroundWork } from '../../../_core/ports/background-work'
import { trackThreadChange } from './thread-changes-pending'
import { bumpAndEnrichThread } from './thread-changed'
import type { ThreadChangedSignal } from './thread-signal.bus'

const logger = new Logger('ThreadChangeRunner')

export class ThreadChangeRunner {
  private readonly changing = new Map<string, { dirty: boolean; done: Promise<void> }>()

  threadChanged(args: {
    threadId: string
    background: BackgroundWork
    publish: (signal: ThreadChangedSignal) => Promise<void>
  }): void {
    const running = this.changing.get(args.threadId)
    if (running !== undefined) {
      running.dirty = true
      return
    }
    const entry = { dirty: false, done: Promise.resolve() }
    this.changing.set(args.threadId, entry)
    entry.done = this.runChanges({ threadId: args.threadId, entry, publish: args.publish })
    trackThreadChange(entry.done)
    args.background.keepAlive(entry.done)
  }

  async changesSettled(): Promise<void> {
    while (this.changing.size > 0) {
      await Promise.all([...this.changing.values()].map((entry) => entry.done))
    }
  }

  private async runChanges(args: {
    threadId: string
    entry: { dirty: boolean }
    publish: (signal: ThreadChangedSignal) => Promise<void>
  }): Promise<void> {
    try {
      do {
        args.entry.dirty = false
        try {
          const changed = await bumpAndEnrichThread({ threadId: args.threadId })
          if (changed !== null) await args.publish(changed)
        } catch (failure) {
          logger.warn(`publishing the change of ${args.threadId} failed: ${String(failure)}`)
        }
      } while (args.entry.dirty)
    } finally {
      this.changing.delete(args.threadId)
    }
  }
}
