import { CloudError } from './cloud-transport'
import type { PrSubscriptionClient } from './pr-subscription-client'
import type { AppInstallRaiser } from './app-install-recommendation'
import { SseRefused } from './sse-client'
import { subscribeTargetOf } from './sse-pull-request-readings'
import type { SseSubscriptionBook } from './sse-pull-request-book'

export async function refreshSubscriptions(args: {
  controller: AbortController
  generation: number
  currentGeneration: () => number
  book: SseSubscriptionBook
  client: PrSubscriptionClient
  raiseAppInstall: AppInstallRaiser
  noteAlive: () => void
}): Promise<void> {
  const live = (): boolean =>
    !args.controller.signal.aborted && args.generation === args.currentGeneration()

  for (const entry of args.book.entries()) {
    if (!live()) return
    try {
      const outcome = await args.client.subscribe(
        subscribeTargetOf({ repoFullName: entry.handle.repoFullName, by: entry.by }),
      )
      if (!live()) return
      args.book.recordResubscribe({
        key: entry.key,
        handle: { id: outcome.id, repoFullName: entry.handle.repoFullName },
        state: outcome.state,
        pollBacked: outcome.pollBacked,
      })
      args.raiseAppInstall(outcome)
    } catch (failure) {
      if (!live()) return
      if (failure instanceof CloudError && (failure.status === 401 || failure.status === 403)) {
        throw new SseRefused(failure.status)
      }
      throw failure
    }
  }
  args.noteAlive()
}
