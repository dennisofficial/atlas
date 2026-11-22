import {
  EAgentStatus,
  ESessionStatus,
  ESubscriptionActor,
  ESubscriptionTone,
  type PlanTask,
  type SpendTally,
} from '@dltech/atlas-core'
import type { CrewRow } from '@dltech/atlas-plugin-crew/client'
import type { PreviewItem } from '@dltech/atlas-plugin-services/client'
import type {
  SessionStatusOutput,
  SessionSubscription,
  SessionViewOutput,
} from '@dltech/atlas-protocol'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'

import type { SessionViewModel } from '../../data/session-view-model'
import type { SubscriptionRow } from '../../data/subscription-rows'
import type { SessionPaneValue } from '../pane-value'

export const statusFixture: SessionStatusOutput = {
  state: ESessionStatus.Thinking,
  lease: { epoch: 1, holderHostId: 7, live: true },
}

export const spendFixture: SpendTally = {
  inputTokens: 4_000,
  outputTokens: 1_200,
  cacheReadTokens: 2_000,
  cacheWriteTokens: 0,
  uncachedInputTokens: 2_000,
  costUsd: 0.5,
}

export const pullRequestFixture: PullRequestEntry = {
  repo: 'owner/atlas',
  number: 7,
  url: 'https://github.com/owner/atlas/pull/7',
  branch: 'dennis/v2-session-pane',
  state: 'open',
  title: 'Add the session pane',
  checksRunning: 1,
  checksPassed: 3,
  checksFailed: 0,
  checksExpected: 0,
  checksState: undefined,
  mergeable: true,
  current: true,
  via: undefined,
}

export const sessionSubscriptionFixture = (
  overrides: Partial<SessionSubscription> = {},
): SessionSubscription => ({
  id: 'sub_7',
  threadId: 't1',
  provider: 'github.pull-request',
  target: { repo: 'github.com/owner/atlas', number: 7 },
  label: 'owner/atlas#7',
  events: [],
  createdBy: 'agent',
  createdAt: '2026-11-08T10:00:00.000Z',
  expiresAt: null,
  ...overrides,
})

export const subscriptionRowFixture = (
  overrides: Partial<SubscriptionRow> = {},
): SubscriptionRow => ({
  id: 'sub_7',
  createdBy: ESubscriptionActor.Agent,
  target: { repo: 'github.com/owner/atlas', number: 7 },
  presentation: {
    icon: 'git-pull-request',
    tone: ESubscriptionTone.Open,
    title: '#7 Add the session pane',
    meta: ['Pull request', 'all events'],
  },
  ...overrides,
})

export const previewFixture: PreviewItem = {
  serviceId: 'svc-web',
  label: 'web',
  port: 4321,
  url: 'https://4321-abc.byatlas.dev',
}

export const crewRowFixture = (overrides: Partial<CrewRow> = {}): CrewRow => ({
  agentId: 'agent-1',
  agentType: 'general-purpose',
  intent: 'work the branch',
  status: EAgentStatus.Running,
  turns: 1,
  toolCalls: 2,
  startedAt: '2026-11-18T10:00:00.000Z',
  ...overrides,
})

export const viewModelFixture = (overrides: Partial<SessionViewModel> = {}): SessionViewModel => ({
  branch: undefined,
  entries: [],
  subscriptionRows: [],
  shells: { running: 0, awaitingInput: false, labels: [], rows: [] },
  crew: { running: 0, total: 0 },
  crewRows: [],
  previews: [],
  plan: [],
  context: null,
  spend: null,
  compute: { costUsd: null, running: false, tick: null },
  ...overrides,
})

export const checkoutsFixture = (
  overrides: Partial<SessionViewOutput['checkouts']> = {},
): SessionViewOutput['checkouts'] => ({ repos: [], primary: null, ...overrides })

export const paneValueFixture = (overrides: Partial<SessionPaneValue> = {}): SessionPaneValue => ({
  sessionId: 'ses-1',
  title: 'Rebase ui on shadcn base-nova',
  startedAt: '2026-11-18T10:00:00.000Z',
  projectId: 'proj-1',
  view: viewModelFixture(),
  viewLoaded: true,
  checkouts: checkoutsFixture(),
  status: statusFixture,
  shellTails: {},
  openTab: () => undefined,
  openBrowser: () => undefined,
  ...overrides,
})

export const populatedPaneValue = (): SessionPaneValue =>
  paneValueFixture({
    view: viewModelFixture({
      branch: 'dennis/v2-session-pane',
      entries: [pullRequestFixture],
      subscriptionRows: [subscriptionRowFixture()],
      shells: {
        running: 1,
        awaitingInput: false,
        labels: ['dev server'],
        rows: [{ shellId: 'sh1', name: 'dev server' }],
      },
      crew: { running: 1, total: 2 },
      crewRows: [
        crewRowFixture(),
        crewRowFixture({ agentId: 'agent-2', agentType: 'explore', intent: 'map the seam' }),
      ],
      previews: [previewFixture],
      context: { used: 1_200, limit: 200_000 },
      spend: spendFixture,
    }),
    checkouts: checkoutsFixture({
      repos: [
        {
          repo: 'owner/atlas',
          base: 'main',
          head: 'dennis/v2-session-pane',
          branches: [{ name: 'dennis/v2-session-pane', sha: 'abc123', worktreePath: '/work/wt' }],
        },
      ],
      primary: { repo: 'owner/atlas', branch: 'dennis/v2-session-pane' },
    }),
    shellTails: { sh1: 'tick 1' },
  })

export const planTaskFixture = (overrides: Partial<PlanTask> = {}): PlanTask => ({
  ordinal: 1,
  text: 'Read the v2 pane brief',
  status: 'completed' as PlanTask['status'],
  ...overrides,
})
