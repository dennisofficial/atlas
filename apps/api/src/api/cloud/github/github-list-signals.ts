import type { Row } from '@dltech/atlas-db'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'

export async function announceSubscriberThreads(args: {
  signals: Pick<ThreadSignalsService, 'listChanged'>
  subscribers: readonly Pick<Row<'GithubSubscription'>, 'userId' | 'threadId'>[]
}): Promise<void> {
  for (const { userId, threadId } of args.subscribers) {
    if (threadId !== null) await args.signals.listChanged({ userId, threadId })
  }
}
