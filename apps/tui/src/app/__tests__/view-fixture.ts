import { ESessionStatus } from '@dltech/atlas-core'
import type { SessionViewOutput, StreamSessionRow } from '@dltech/atlas-protocol'

const STATUS = { state: ESessionStatus.Thinking, lease: { epoch: 1, holderHostId: 7, live: true } }

export const VIEW_FIXTURE: SessionViewOutput = {
  at: 413,
  status: STATUS,
  context: null,
  spend: {
    rows: [],
    tally: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      uncachedInputTokens: 0,
      costUsd: null,
    },
  },
  checkouts: { repos: [], primary: null },
  pullRequests: [],
  subscriptions: [],
  pluginViews: {},
  compute: { costUsd: null, running: false, tick: null },
}

export const viewFixture = (patch: Partial<SessionViewOutput>): SessionViewOutput => ({
  ...VIEW_FIXTURE,
  ...patch,
})

export const sessionRowFixture = (patch: Partial<StreamSessionRow>): StreamSessionRow => ({
  sessionId: 'session-one',
  projectId: null,
  title: 'the open session',
  naming: false,
  mainThreadId: 'thread-1',
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  archivedAt: null,
  model: { ref: 'claude-sonnet-4-5', effort: 'high', fast: false },
  ...patch,
})
