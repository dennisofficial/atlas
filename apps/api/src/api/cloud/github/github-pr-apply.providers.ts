import type { Provider } from '@nestjs/common'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { replayThreadEvents } from './github-pr-event-thread-replay'
import { buildPrApplyWiring, type PrApplyWiring } from '@dltech/atlas-github'
import { GithubPrEventMailboxService } from '@dltech/atlas-github'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { GithubPrOutboxDispatcher } from '@dltech/atlas-github'
import { GithubPrStore } from '@dltech/atlas-github'
import { GithubFillTokens } from '@dltech/atlas-github'
import { GithubInstallationTokens } from '@dltech/atlas-github'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { GithubUserReads } from '@dltech/atlas-github'
import { GithubService } from '@dltech/atlas-github'

export const PR_APPLY_WIRING = 'PrApplyWiring'

export const prApplyWiringProvider: Provider = {
  provide: PR_APPLY_WIRING,
  useFactory: (
    fanout: GithubPrFanoutService,
    signals: ThreadSignalsService,
    wake: GithubSandboxWakeService,
    reads: GithubUserReads,
    budget: GithubRequestCoordinator,
    github: GithubService,
    appTokens: GithubInstallationTokens,
  ) => {
    const fillTokens = new GithubFillTokens({ github, appTokens })

    return buildPrApplyWiring({
      fanout,
      legacy: {
        threadChanged: (args) => signals.threadChanged(args),
        notifyEvent: (notice, event) => wake.notifyEvent(notice, event),
      },
      replayThread: replayThreadEvents,
      reads,
      budget,
      fillTokenOf: (args) => fillTokens.find(args),
    })
  },
  inject: [
    GithubPrFanoutService,
    ThreadSignalsService,
    GithubSandboxWakeService,
    GithubUserReads,
    GithubRequestCoordinator,
    GithubService,
    GithubInstallationTokens,
  ],
}

export const mailboxProvider: Provider = {
  provide: GithubPrEventMailboxService,
  useFactory: (wiring: PrApplyWiring) => wiring.mailbox,
  inject: [PR_APPLY_WIRING],
}

export const outboxDispatcherProvider: Provider = {
  provide: GithubPrOutboxDispatcher,
  useFactory: (wiring: PrApplyWiring) => wiring.dispatcher,
  inject: [PR_APPLY_WIRING],
}

export const prStoreProvider: Provider = {
  provide: GithubPrStore,
  useFactory: (wiring: PrApplyWiring) => wiring.store,
  inject: [PR_APPLY_WIRING],
}
