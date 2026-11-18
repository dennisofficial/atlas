import { DrainStateService } from '../../platform/health/drain-state.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { GithubPrStore } from './github-pr-store'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

export function inertWake(): GithubSandboxWakeService {
  return { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
}

export function storeFixture(
  args: { fanout?: GithubPrFanoutService; wake?: GithubSandboxWakeService } = {},
): GithubPrStore {
  const fanout = args.fanout ?? new GithubPrFanoutService(new DrainStateService())
  const wake = args.wake ?? inertWake()
  const dispatcher = new GithubPrOutboxDispatcher({ fanout, signals: inertSignals(), wake })

  return new GithubPrStore({
    mailbox: new GithubPrEventMailboxService(fanout, dispatcher),
    dispatcher,
  })
}
