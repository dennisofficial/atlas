import type { Provider } from '@nestjs/common'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { GithubPrStore } from './github-pr-store'
import { GithubSandboxWakeService } from './github-sandbox-wake.service'

export const outboxDispatcherProvider: Provider = {
  provide: GithubPrOutboxDispatcher,
  useFactory: (
    fanout: GithubPrFanoutService,
    signals: ThreadSignalsService,
    wake: GithubSandboxWakeService,
  ) => new GithubPrOutboxDispatcher({ fanout, signals, wake }),
  inject: [GithubPrFanoutService, ThreadSignalsService, GithubSandboxWakeService],
}

export const prStoreProvider: Provider = {
  provide: GithubPrStore,
  useFactory: (mailbox: GithubPrEventMailboxService, dispatcher: GithubPrOutboxDispatcher) =>
    new GithubPrStore({ mailbox, dispatcher }),
  inject: [GithubPrEventMailboxService, GithubPrOutboxDispatcher],
}
