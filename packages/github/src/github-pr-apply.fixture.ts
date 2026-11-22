import { EPrSource, EPrState, type PrObservation, type PullSample } from '@dltech/atlas-core'
import { RecordingDrain } from './testing/drain.fixture'
import { vi } from 'bun:test'
import { recordingSignals } from './testing/thread-signals.fixture'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrOutboxDispatcher } from './github-pr-outbox'
import { GithubPrStore } from './github-pr-store'
import { inertMergeabilityRefresh, inertReconcile } from './github-pr-store.fixture'
import type { WakeStub } from './github-legacy-effects.fixture'
import { legacyOf } from './github-legacy-effects.fixture'

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
  const fanout = new GithubPrFanoutService(new RecordingDrain())
  const wake = { notifyEvent: vi.fn() } as unknown as WakeStub
  const { signals, changedThreads } = recordingSignals()
  const dispatcher = new GithubPrOutboxDispatcher({
    fanout: overrides.fanout ?? fanout,
    legacy: legacyOf({ signals: signals, wake: wake }),
    reconcile: inertReconcile(),
    mergeability: inertMergeabilityRefresh(),
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
