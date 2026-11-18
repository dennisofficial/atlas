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

export function storeFixture(args: { fanout?: GithubPrFanoutService } = {}): GithubPrStore {
  const fanout = args.fanout ?? new GithubPrFanoutService(new DrainStateService())
  const wake = inertWake()

  return new GithubPrStore({
    mailbox: new GithubPrEventMailboxService(fanout, wake),
    dispatcher: new GithubPrOutboxDispatcher({ fanout, signals: inertSignals(), wake }),
  })
}
