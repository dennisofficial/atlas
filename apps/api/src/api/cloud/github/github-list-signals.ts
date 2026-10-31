import type { Row } from '@dltech/atlas-db'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'

export async function announceSubscriberThreads(args: {
  signals: Pick<ThreadSignalsService, 'threadChanged'>
  subscribers: readonly Pick<Row<'GithubSubscription'>, 'threadId'>[]
}): Promise<void> {
  for (const { threadId } of args.subscribers) {
    if (threadId !== null) args.signals.threadChanged({ threadId })
  }
}
