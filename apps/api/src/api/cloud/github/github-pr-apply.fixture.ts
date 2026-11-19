import { EPrSource, EPrState, type PrObservation, type PullSample } from '@dltech/atlas-core'
import { vi } from 'bun:test'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { recordingSignals } from '../../platform/sessions/thread-signals.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { GithubPrStore } from './github-pr-store'
import { inertReconcile } from './github-pr-store.fixture'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

export const SAMPLE: PullSample = {
  repoFullName: 'compai/app',
  prNumber: 42,
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: EPrState.Open,
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  headRepoFullName: 'compai/app',
  baseBranch: 'main',
  pullUpdatedAt: '2026-11-18T10:00:00Z',
  closedAt: null,
  mergedAt: null,
}

export const pull = (over: Partial<PullSample> = {}): PrObservation => ({
  kind: 'pull',
  source: EPrSource.Poll,
  observedAt: '2026-11-18T10:00:00Z',
  sample: { ...SAMPLE, ...over },
})

export const applyArgs = (observations: readonly PrObservation[]) => ({
  repoFullName: 'compai/app',
  prNumber: 42,
  observations,
})

export function rig(
  overrides: {
    mailbox?: GithubPrEventMailboxService
    fanout?: Pick<GithubPrFanoutService, 'push' | 'pushEvent'>
  } = {},
) {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: vi.fn() } as unknown as GithubSandboxWakeService
  const { signals, changedThreads } = recordingSignals()
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: overrides.fanout ?? fanout,
    signals,
    wake,
    reconcile: inertReconcile(),
  })
  const mailbox = overrides.mailbox ?? new GithubPrEventMailboxService(fanout, dispatcher)

  return {
    store: new GithubPrStore({ mailbox, dispatcher }),
    fanout,
    wake,
    signals,
    changedThreads,
  }
}
