import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { Logger } from '@nestjs/common'
import { readPodFrame } from './pod-snapshot'
import type { ThreadFrameSignal } from './thread-signal.bus'

const logger = new Logger('PodChangePublisher')

export class PodChangePublisher {
  private readonly pending = new Map<string, Promise<void>>()

  publish(args: {
    threadId: string
    publish: (signal: ThreadFrameSignal) => Promise<void>
    threadChanged: () => void
  }): Promise<void> {
    const previous = this.pending.get(args.threadId) ?? Promise.resolve()
    const done = previous
      .catch(() => {})
      .then(async () => {
        let frame: ThreadStreamFrame = { type: EThreadStreamFrame.Pod }
        try {
          frame = await readPodFrame({ threadId: args.threadId, bumpRev: true })
        } catch (failure) {
          logger.warn(`reading pod status of ${args.threadId} failed: ${String(failure)}`)
        }
        await args.publish({ threadId: args.threadId, frame })
        args.threadChanged()
      })
    this.pending.set(args.threadId, done)
    void done
      .finally(() => {
        if (this.pending.get(args.threadId) === done) this.pending.delete(args.threadId)
      })
      .catch(() => {})
    return done
  }
}
